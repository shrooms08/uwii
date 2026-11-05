//! Uwii report anchor: records the SHA-256 fingerprint of a final Uwii tax report with the block
//! time and height it was anchored at. Only the fingerprint and status go on-chain; nothing in the
//! report itself. Only the owner (Uwii's anchoring account, set at init) can write.
use near_sdk::json_types::U64;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near, require};

/// NEP-297 event standard name and version for anchor events.
pub const EVENT_STANDARD: &str = "uwii_anchor";
pub const EVENT_VERSION: &str = "1.0.0";
/// The only report status that may be anchored.
pub const FINAL_STATUS: &str = "final";

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Anchors,
}

/// One anchored report fingerprint.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    /// SHA-256 of the canonical report data, 64 lowercase hex characters.
    pub fingerprint: String,
    /// Report status at anchoring time (always "final").
    pub status: String,
    /// Block timestamp in nanoseconds.
    pub anchored_at_ns: U64,
    pub block_height: U64,
    pub anchored_by: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    anchors: LookupMap<String, Anchor>,
}

/// 64 characters, each 0-9 or a-f.
fn is_fingerprint(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[near]
impl Contract {
    /// Initialise with the account allowed to anchor.
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, anchors: LookupMap::new(StorageKey::Anchors) }
    }

    /// Anchor a final report fingerprint. Owner only; each fingerprint can be anchored once.
    pub fn anchor(&mut self, fingerprint: String, status: String) -> Anchor {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can anchor");
        require!(is_fingerprint(&fingerprint), "fingerprint must be 64 lowercase hex characters");
        require!(status == FINAL_STATUS, "only final reports can be anchored");
        require!(!self.anchors.contains_key(&fingerprint), "fingerprint already anchored");

        let anchor = Anchor {
            fingerprint: fingerprint.clone(),
            status,
            anchored_at_ns: U64(env::block_timestamp()),
            block_height: U64(env::block_height()),
            anchored_by: env::predecessor_account_id(),
        };
        self.anchors.insert(fingerprint, anchor.clone());

        let event = near_sdk::serde_json::json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": "anchor",
            "data": [anchor],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
        anchor
    }

    /// The anchor for a fingerprint, if any.
    pub fn get_anchor(&self, fingerprint: String) -> Option<Anchor> {
        self.anchors.get(&fingerprint).cloned()
    }

    /// The account allowed to anchor.
    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, get_logs};
    use near_sdk::testing_env;

    const FP: &str = "a4a1c78044e9c3c21602267480350e7b9cce3fdaf8fdcedfc6e03992f1a994df";

    fn owner() -> AccountId {
        "uwii-anchor.testnet".parse().unwrap()
    }

    fn context(predecessor: AccountId) {
        let ctx = VMContextBuilder::new()
            .current_account_id(owner())
            .predecessor_account_id(predecessor)
            .block_timestamp(1_762_380_000_000_000_000)
            .block_height(220_000_123)
            .build();
        testing_env!(ctx);
    }

    fn contract() -> Contract {
        context(owner());
        Contract::new(owner())
    }

    #[test]
    fn valid_anchor_is_stored_with_time_height_and_event() {
        let mut c = contract();
        let a = c.anchor(FP.to_string(), "final".to_string());
        assert_eq!(a.fingerprint, FP);
        assert_eq!(a.status, "final");
        assert_eq!(a.anchored_at_ns, U64(1_762_380_000_000_000_000));
        assert_eq!(a.block_height, U64(220_000_123));
        assert_eq!(a.anchored_by, owner());
        assert_eq!(c.get_anchor(FP.to_string()), Some(a.clone()));
        assert_eq!(c.get_anchor("0".repeat(64)), None);

        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        let json = logs[0].strip_prefix("EVENT_JSON:").expect("NEP-297 prefix");
        let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(json).unwrap();
        assert_eq!(v["standard"], EVENT_STANDARD);
        assert_eq!(v["version"], EVENT_VERSION);
        assert_eq!(v["event"], "anchor");
        assert_eq!(v["data"][0]["fingerprint"], FP);
        assert_eq!(v["data"][0]["block_height"], "220000123");
    }

    #[test]
    #[should_panic(expected = "fingerprint already anchored")]
    fn duplicate_rejected() {
        let mut c = contract();
        c.anchor(FP.to_string(), "final".to_string());
        c.anchor(FP.to_string(), "final".to_string());
    }

    #[test]
    #[should_panic(expected = "fingerprint must be 64 lowercase hex characters")]
    fn uppercase_hex_rejected() {
        let mut c = contract();
        c.anchor(FP.to_uppercase(), "final".to_string());
    }

    #[test]
    #[should_panic(expected = "fingerprint must be 64 lowercase hex characters")]
    fn short_or_non_hex_rejected() {
        let mut c = contract();
        c.anchor(format!("{}zz", &FP[..62]), "final".to_string());
    }

    #[test]
    #[should_panic(expected = "fingerprint must be 64 lowercase hex characters")]
    fn wrong_length_rejected() {
        let mut c = contract();
        c.anchor(FP[..63].to_string(), "final".to_string());
    }

    #[test]
    #[should_panic(expected = "only final reports can be anchored")]
    fn non_final_rejected() {
        let mut c = contract();
        c.anchor(FP.to_string(), "draft".to_string());
    }

    #[test]
    #[should_panic(expected = "Only the owner can anchor")]
    fn non_owner_rejected() {
        let mut c = contract();
        context("someone-else.testnet".parse().unwrap());
        c.anchor(FP.to_string(), "final".to_string());
    }

    #[test]
    fn owner_is_reported() {
        let c = contract();
        assert_eq!(c.get_owner(), owner());
    }
}
