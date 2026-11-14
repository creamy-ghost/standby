//! Standby validation — local NEAR sandbox only.
//!
//! Useful task: solve a small integer linear system A x = b. The buyer publishes
//! A and b but does NOT precompute x. The pinned on-chain evaluator checks the
//! submitted solution exactly: for every row, sum(A[i][j] * x[j]) == b[i].
//! There is no caller-supplied verifier and no public expected-result digest.
//!
//! Lifecycle fixes over the previous demo:
//! - Unaccepted primary can be expired after its deadline, refunding the buyer
//!   and enabling standby activation or ordinary retry.
//! - Unsold standby bond can be reclaimed after option expiry.
//! - Ordinary retry is a first-class escrow path on the same job/evaluator.
//! - Settlement credits are per-account; withdrawal restores credit on failed transfer.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Created,
    PrimaryActive,
    PrimaryFailed,
    StandbyActive,
    RetryActive,
    Completed,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OfferStatus {
    Offered,
    Optioned,
    Activated,
    Completed,
    Expired,
    Slashed,
    Reclaimed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetryStatus {
    Created,
    Accepted,
    Completed,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Retry {
    pub worker: AccountId,
    pub fee: U128,
    pub bond: U128,
    pub deadline_ms: u64,
    pub status: RetryStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: u64,
    pub job_ref: String,
    pub buyer: AccountId,
    pub primary: AccountId,
    pub primary_fee: U128,
    pub primary_bond: U128,
    pub primary_deadline_ms: u64,
    pub n: u64,
    pub a: Vec<i64>,
    pub b: Vec<i64>,
    pub input_hash: String,
    pub status: JobStatus,
    pub standby_offer_id: Option<u64>,
    pub retry: Option<Retry>,
    pub solution: Option<Vec<i64>>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub id: u64,
    pub job_id: u64,
    pub provider: AccountId,
    pub resource_id: String,
    pub premium: U128,
    pub strike: U128,
    pub bond: U128,
    pub activate_after_ms: u64,
    pub option_expiry_ms: u64,
    pub delivery_deadline_ms: u64,
    pub status: OfferStatus,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct StandbyValidation {
    jobs: Vec<Job>,
    offers: Vec<Offer>,
    credits: LookupMap<AccountId, u128>,
    credits_total: u128,
    next_job: u64,
    next_offer: u64,
}

#[near]
impl StandbyValidation {
    #[init]
    pub fn new() -> Self {
        Self {
            jobs: Vec::new(),
            offers: Vec::new(),
            credits: LookupMap::new(b"credits".as_slice()),
            credits_total: 0,
            next_job: 1,
            next_offer: 1,
        }
    }

    /// Buyer publishes the linear system and funds the primary fee.
    /// The evaluator is the contract itself plus this job's A and b.
    #[payable]
    pub fn create_job(
        &mut self,
        job_ref: String,
        n: u64,
        a: Vec<i64>,
        b: Vec<i64>,
        input_hash: String,
        primary: AccountId,
        primary_fee: U128,
        primary_deadline_ms: u64,
    ) -> u64 {
        let buyer = env::predecessor_account_id();
        require!(env::attached_deposit().as_yoctonear() == primary_fee.0, "exact primary fee required");
        require!(primary_fee.0 > 0, "primary fee required");
        require!(primary != buyer, "primary must differ from buyer");
        require!(!job_ref.is_empty() && job_ref.len() <= 128, "bad job_ref");
        require!(n >= 2 && n <= 32, "bad n");
        require!(a.len() as u64 == n * n, "bad matrix length");
        require!(b.len() as u64 == n, "bad rhs length");
        require!(input_hash.len() == 64, "input_hash must be 64 hex chars");
        require!(primary_deadline_ms > env::block_timestamp_ms(), "primary deadline in past");
        require!(!self.jobs.iter().any(|j| j.buyer == buyer && j.job_ref == job_ref), "duplicate job_ref");
        let id = self.next_job;
        self.next_job += 1;
        self.jobs.push(Job {
            id, job_ref, buyer, primary, primary_fee,
            primary_bond: U128(0), primary_deadline_ms,
            n, a, b, input_hash,
            status: JobStatus::Created,
            standby_offer_id: None, retry: None, solution: None,
        });
        id
    }

    #[payable]
    pub fn accept_primary(&mut self, job_id: u64) {
        let bond = env::attached_deposit().as_yoctonear();
        require!(bond > 0, "primary bond required");
        let i = self.job_idx(job_id);
        require!(self.jobs[i].status == JobStatus::Created, "not created");
        require!(env::predecessor_account_id() == self.jobs[i].primary, "only primary");
        require!(env::block_timestamp_ms() <= self.jobs[i].primary_deadline_ms, "primary deadline passed");
        self.jobs[i].primary_bond = U128(bond);
        self.jobs[i].status = JobStatus::PrimaryActive;
    }

    /// Unaccepted primary expiry: refund fee, mark primary failed, enable replacement.
    pub fn expire_unaccepted_primary(&mut self, job_id: u64) {
        let i = self.job_idx(job_id);
        require!(self.jobs[i].status == JobStatus::Created, "not created");
        require!(env::block_timestamp_ms() > self.jobs[i].primary_deadline_ms, "not late");
        self.jobs[i].status = JobStatus::PrimaryFailed;
        let buyer = self.jobs[i].buyer.clone();
        let fee = self.jobs[i].primary_fee.0;
        self.credit(&buyer, fee);
    }

    /// Accepted primary missed deadline: refund fee + bond.
    pub fn fail_primary(&mut self, job_id: u64) {
        let i = self.job_idx(job_id);
        require!(self.jobs[i].status == JobStatus::PrimaryActive, "not primary active");
        require!(env::block_timestamp_ms() > self.jobs[i].primary_deadline_ms, "not late");
        self.jobs[i].status = JobStatus::PrimaryFailed;
        let buyer = self.jobs[i].buyer.clone();
        let amount = self.jobs[i].primary_fee.0 + self.jobs[i].primary_bond.0;
        self.credit(&buyer, amount);
    }

    pub fn complete_primary(&mut self, job_id: u64, solution: Vec<i64>) {
        let i = self.job_idx(job_id);
        require!(self.jobs[i].status == JobStatus::PrimaryActive, "not primary active");
        require!(env::predecessor_account_id() == self.jobs[i].primary, "only primary");
        require!(env::block_timestamp_ms() <= self.jobs[i].primary_deadline_ms, "delivery late");
        self.verify_solution(i, &solution);
        self.jobs[i].status = JobStatus::Completed;
        self.jobs[i].solution = Some(solution);
        let primary = self.jobs[i].primary.clone();
        let amount = self.jobs[i].primary_fee.0 + self.jobs[i].primary_bond.0;
        self.credit(&primary, amount);
    }

    #[payable]
    pub fn create_standby_offer(
        &mut self,
        job_id: u64,
        resource_id: String,
        premium: U128,
        strike: U128,
        activate_after_ms: u64,
        option_expiry_ms: u64,
        delivery_deadline_ms: u64,
    ) -> u64 {
        let bond = env::attached_deposit().as_yoctonear();
        require!(bond > 0, "standby bond required");
        require!(premium.0 > 0 && strike.0 > 0, "premium and strike required");
        require!(!resource_id.is_empty() && resource_id.len() <= 128, "bad resource_id");
        let ji = self.job_idx(job_id);
        let now = env::block_timestamp_ms();
        require!(matches!(self.jobs[ji].status, JobStatus::Created | JobStatus::PrimaryActive | JobStatus::PrimaryFailed), "job not open for standby");
        require!(self.jobs[ji].standby_offer_id.is_none(), "standby already exists");
        require!(self.jobs[ji].retry.is_none(), "retry already exists");
        let caller = env::predecessor_account_id();
        require!(caller != self.jobs[ji].primary, "standby must differ from primary");
        require!(activate_after_ms >= self.jobs[ji].primary_deadline_ms, "activation before primary deadline");
        require!(activate_after_ms < option_expiry_ms, "bad activation window");
        require!(option_expiry_ms < delivery_deadline_ms, "bad delivery window");
        require!(option_expiry_ms > now, "option already expired");
        let id = self.next_offer;
        self.next_offer += 1;
        self.offers.push(Offer {
            id, job_id, provider: caller, resource_id, premium, strike,
            bond: U128(bond), activate_after_ms, option_expiry_ms, delivery_deadline_ms,
            status: OfferStatus::Offered,
        });
        id
    }

    #[payable]
    pub fn buy_standby_option(&mut self, offer_id: u64) {
        let oi = self.offer_idx(offer_id);
        let ji = self.job_idx(self.offers[oi].job_id);
        require!(self.offers[oi].status == OfferStatus::Offered, "not offered");
        require!(env::block_timestamp_ms() < self.offers[oi].option_expiry_ms, "option expired");
        require!(env::predecessor_account_id() == self.jobs[ji].buyer, "only job buyer");
        require!(matches!(self.jobs[ji].status, JobStatus::Created | JobStatus::PrimaryActive | JobStatus::PrimaryFailed), "job not open");
        require!(self.jobs[ji].retry.is_none(), "retry already exists");
        let need = self.offers[oi].premium.0 + self.offers[oi].strike.0;
        require!(env::attached_deposit().as_yoctonear() == need, "exact premium+strike required");
        self.offers[oi].status = OfferStatus::Optioned;
        self.jobs[ji].standby_offer_id = Some(offer_id);
    }

    pub fn reclaim_unsold_offer(&mut self, offer_id: u64) {
        let oi = self.offer_idx(offer_id);
        require!(self.offers[oi].status == OfferStatus::Offered, "not offered");
        require!(env::block_timestamp_ms() > self.offers[oi].option_expiry_ms, "not expired");
        self.offers[oi].status = OfferStatus::Reclaimed;
        let provider = self.offers[oi].provider.clone();
        let bond = self.offers[oi].bond.0;
        self.credit(&provider, bond);
    }

    pub fn activate_standby(&mut self, offer_id: u64) {
        let oi = self.offer_idx(offer_id);
        let ji = self.job_idx(self.offers[oi].job_id);
        require!(self.offers[oi].status == OfferStatus::Optioned, "not optioned");
        require!(self.jobs[ji].status == JobStatus::PrimaryFailed, "primary not failed");
        require!(self.jobs[ji].retry.is_none(), "retry already exists");
        require!(env::predecessor_account_id() == self.jobs[ji].buyer, "only job buyer");
        let now = env::block_timestamp_ms();
        require!(now >= self.offers[oi].activate_after_ms, "too early");
        require!(now <= self.offers[oi].option_expiry_ms, "option expired");
        self.offers[oi].status = OfferStatus::Activated;
        self.jobs[ji].status = JobStatus::StandbyActive;
    }

    pub fn complete_standby(&mut self, offer_id: u64, solution: Vec<i64>) {
        let oi = self.offer_idx(offer_id);
        let ji = self.job_idx(self.offers[oi].job_id);
        require!(self.offers[oi].status == OfferStatus::Activated, "not activated");
        require!(self.jobs[ji].status == JobStatus::StandbyActive, "job not standby active");
        require!(env::predecessor_account_id() == self.offers[oi].provider, "only standby provider");
        require!(env::block_timestamp_ms() <= self.offers[oi].delivery_deadline_ms, "delivery late");
        self.verify_solution(ji, &solution);
        self.offers[oi].status = OfferStatus::Completed;
        self.jobs[ji].status = JobStatus::Completed;
        self.jobs[ji].solution = Some(solution);
        let provider = self.offers[oi].provider.clone();
        let amount = self.offers[oi].premium.0 + self.offers[oi].strike.0 + self.offers[oi].bond.0;
        self.credit(&provider, amount);
    }

    pub fn expire_standby(&mut self, offer_id: u64) {
        let oi = self.offer_idx(offer_id);
        let ji = self.job_idx(self.offers[oi].job_id);
        require!(self.offers[oi].status == OfferStatus::Optioned, "not optioned");
        require!(env::block_timestamp_ms() > self.offers[oi].option_expiry_ms, "not expired");
        self.offers[oi].status = OfferStatus::Expired;
        let provider = self.offers[oi].provider.clone();
        let buyer = self.jobs[ji].buyer.clone();
        self.credit(&provider, self.offers[oi].premium.0 + self.offers[oi].bond.0);
        self.credit(&buyer, self.offers[oi].strike.0);
        if self.jobs[ji].status == JobStatus::PrimaryFailed {
            self.jobs[ji].status = JobStatus::Failed;
        }
    }

    pub fn slash_standby(&mut self, offer_id: u64) {
        let oi = self.offer_idx(offer_id);
        let ji = self.job_idx(self.offers[oi].job_id);
        require!(self.offers[oi].status == OfferStatus::Activated, "not activated");
        require!(env::block_timestamp_ms() > self.offers[oi].delivery_deadline_ms, "not late");
        self.offers[oi].status = OfferStatus::Slashed;
        self.jobs[ji].status = JobStatus::Failed;
        let buyer = self.jobs[ji].buyer.clone();
        let amount = self.offers[oi].premium.0 + self.offers[oi].strike.0 + self.offers[oi].bond.0;
        self.credit(&buyer, amount);
    }

    /// Ordinary retry escrow on the same job and evaluator. No premium/reservation.
    #[payable]
    pub fn create_retry(&mut self, job_id: u64, worker: AccountId, fee: U128, deadline_ms: u64) {
        let ji = self.job_idx(job_id);
        require!(self.jobs[ji].status == JobStatus::PrimaryFailed, "primary not failed");
        require!(self.jobs[ji].retry.is_none(), "retry already exists");
        require!(self.jobs[ji].standby_offer_id.is_none(), "standby already exists");
        require!(env::predecessor_account_id() == self.jobs[ji].buyer, "only job buyer");
        require!(env::attached_deposit().as_yoctonear() == fee.0, "exact retry fee required");
        require!(fee.0 > 0, "retry fee required");
        require!(worker != self.jobs[ji].buyer, "worker must differ from buyer");
        require!(deadline_ms > env::block_timestamp_ms(), "retry deadline in past");
        self.jobs[ji].retry = Some(Retry { worker, fee, bond: U128(0), deadline_ms, status: RetryStatus::Created });
    }

    #[payable]
    pub fn accept_retry(&mut self, job_id: u64) {
        let bond = env::attached_deposit().as_yoctonear();
        require!(bond > 0, "retry bond required");
        let ji = self.job_idx(job_id);
        let r = self.jobs[ji].retry.as_mut().expect("no retry");
        require!(r.status == RetryStatus::Created, "retry not created");
        require!(env::predecessor_account_id() == r.worker, "only retry worker");
        require!(env::block_timestamp_ms() <= r.deadline_ms, "retry deadline passed");
        r.bond = U128(bond);
        r.status = RetryStatus::Accepted;
        self.jobs[ji].status = JobStatus::RetryActive;
    }

    pub fn complete_retry(&mut self, job_id: u64, solution: Vec<i64>) {
        let ji = self.job_idx(job_id);
        require!(self.jobs[ji].status == JobStatus::RetryActive, "not retry active");
        let r = self.jobs[ji].retry.as_ref().expect("no retry");
        require!(r.status == RetryStatus::Accepted, "retry not accepted");
        require!(env::predecessor_account_id() == r.worker, "only retry worker");
        require!(env::block_timestamp_ms() <= r.deadline_ms, "delivery late");
        self.verify_solution(ji, &solution);
        let worker = r.worker.clone();
        let amount = r.fee.0 + r.bond.0;
        let r = self.jobs[ji].retry.as_mut().expect("no retry");
        r.status = RetryStatus::Completed;
        self.jobs[ji].status = JobStatus::Completed;
        self.jobs[ji].solution = Some(solution);
        self.credit(&worker, amount);
    }

    pub fn fail_retry(&mut self, job_id: u64) {
        let ji = self.job_idx(job_id);
        let r = self.jobs[ji].retry.as_ref().expect("no retry");
        require!(matches!(r.status, RetryStatus::Created | RetryStatus::Accepted), "retry not live");
        require!(env::block_timestamp_ms() > r.deadline_ms, "not late");
        let buyer = self.jobs[ji].buyer.clone();
        let amount = r.fee.0 + r.bond.0;
        let r = self.jobs[ji].retry.as_mut().expect("no retry");
        r.status = RetryStatus::Failed;
        self.jobs[ji].status = JobStatus::Failed;
        self.credit(&buyer, amount);
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        require!(amount.0 > 0, "amount required");
        let caller = env::predecessor_account_id();
        let credit = self.credits.get(&caller).copied().unwrap_or(0);
        require!(credit >= amount.0, "insufficient credit");
        self.credits.insert(caller.clone(), credit - amount.0);
        self.credits_total -= amount.0;
        Promise::new(caller.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_withdraw(caller, amount))
    }

    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.credit(&account, amount.0);
        }
    }

    pub fn get_job(&self, job_id: u64) -> Option<Job> { self.jobs.iter().find(|j| j.id == job_id).cloned() }
    pub fn get_offer(&self, offer_id: u64) -> Option<Offer> { self.offers.iter().find(|o| o.id == offer_id).cloned() }
    pub fn credit_of(&self, account: AccountId) -> U128 { U128(self.credits.get(&account).copied().unwrap_or(0)) }
    pub fn credits_total(&self) -> U128 { U128(self.credits_total) }

    pub fn primary_held(&self, job_id: u64) -> U128 {
        let j = self.jobs.iter().find(|j| j.id == job_id).expect("job not found");
        U128(match j.status {
            JobStatus::Created => j.primary_fee.0,
            JobStatus::PrimaryActive => j.primary_fee.0 + j.primary_bond.0,
            _ => 0,
        })
    }

    pub fn offer_held(&self, offer_id: u64) -> U128 {
        let o = self.offers.iter().find(|o| o.id == offer_id).expect("offer not found");
        U128(match o.status {
            OfferStatus::Offered => o.bond.0,
            OfferStatus::Optioned | OfferStatus::Activated => o.premium.0 + o.strike.0 + o.bond.0,
            _ => 0,
        })
    }

    pub fn retry_held(&self, job_id: u64) -> U128 {
        let j = self.jobs.iter().find(|j| j.id == job_id).expect("job not found");
        U128(match &j.retry {
            Some(r) => match r.status {
                RetryStatus::Created => r.fee.0,
                RetryStatus::Accepted => r.fee.0 + r.bond.0,
                _ => 0,
            },
            None => 0,
        })
    }

    pub fn obligations(&self) -> U128 {
        let mut sum = self.credits_total;
        for j in &self.jobs {
            sum += match j.status {
                JobStatus::Created => j.primary_fee.0,
                JobStatus::PrimaryActive => j.primary_fee.0 + j.primary_bond.0,
                _ => 0,
            };
            if let Some(r) = &j.retry {
                sum += match r.status {
                    RetryStatus::Created => r.fee.0,
                    RetryStatus::Accepted => r.fee.0 + r.bond.0,
                    _ => 0,
                };
            }
        }
        for o in &self.offers {
            sum += match o.status {
                OfferStatus::Offered => o.bond.0,
                OfferStatus::Optioned | OfferStatus::Activated => o.premium.0 + o.strike.0 + o.bond.0,
                _ => 0,
            };
        }
        U128(sum)
    }

    pub fn job_count(&self) -> u64 { self.jobs.len() as u64 }
    pub fn offer_count(&self) -> u64 { self.offers.len() as u64 }

    fn job_idx(&self, id: u64) -> usize { self.jobs.iter().position(|j| j.id == id).expect("job not found") }
    fn offer_idx(&self, id: u64) -> usize { self.offers.iter().position(|o| o.id == id).expect("offer not found") }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 { return; }
        let current = self.credits.get(account).copied().unwrap_or(0);
        self.credits.insert(account.clone(), current + amount);
        self.credits_total += amount;
    }

    /// Pinned evaluator: exact integer residual check for this job's A and b.
    fn verify_solution(&self, ji: usize, solution: &[i64]) {
        let job = &self.jobs[ji];
        let n = job.n as usize;
        require!(solution.len() == n, "bad solution length");
        for i in 0..n {
            let mut acc: i128 = 0;
            for j in 0..n {
                acc += (job.a[i * n + j] as i128) * (solution[j] as i128);
            }
            require!(acc == job.b[i] as i128, "solution does not satisfy job");
        }
    }
}
