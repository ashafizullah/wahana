//! Channel metadata lookups sent with every variable the server expects.
//!
//! `whatsapp-rust` 0.7.0 leaves some variables of these persisted queries out, and the
//! server answers `400 Bad Request` unless every declared variable is present (its value
//! does not matter). Fixed upstream in jlucaso1/whatsapp-rust#1378, not yet released; once
//! a release carries it, `client.newsletter()` can replace this module.

use serde_json::{json, Value};
use whatsapp_rust::features::{
    MexRequest, NewsletterMetadata, NewsletterRole, NewsletterState, NewsletterVerification,
};
use whatsapp_rust::prelude::*;
use whatsapp_rust::wacore::iq::mex_operations::{fetch_all_newsletters_metadata, fetch_newsletter};

/// The error with its causes appended; the library hides the server's answer in `source()`.
fn chain(e: &dyn std::error::Error) -> String {
    let mut text = e.to_string();
    let mut source = e.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

async fn query(client: &Client, request: MexRequest<Value>) -> Result<Value, String> {
    let response = client.mex().query(request).await.map_err(|e| chain(&e))?;
    response.data.ok_or_else(|| "missing data".to_string())
}

async fn lookup(client: &Client, key: &str, kind: &str) -> Result<NewsletterMetadata, String> {
    let variables = json!({
        "input": { "key": key, "type": kind, "view_role": "GUEST" },
        "fetch_viewer_metadata": true,
        "fetch_full_image": true,
        "fetch_creation_time": true,
        "fetch_wamo_sub": false,
        "fetch_status_metadata": false,
        "fetch_pinned_messages": false,
    });
    let data = query(
        client,
        MexRequest::new(fetch_newsletter::NAME, fetch_newsletter::DOC_ID, variables),
    )
    .await?;
    let channel = &data["xwa2_newsletter"];
    if channel.is_null() {
        return Err(format!("channel not found: {key}"));
    }
    parse(channel)
}

/// One channel by its id.
pub async fn get(client: &Client, jid: &Jid) -> Result<NewsletterMetadata, String> {
    lookup(client, &jid.to_string(), "JID").await
}

/// One channel by its invite code.
pub async fn by_invite(client: &Client, code: &str) -> Result<NewsletterMetadata, String> {
    lookup(client, code, "INVITE").await
}

/// Every channel this account follows.
pub async fn subscribed(client: &Client) -> Result<Vec<NewsletterMetadata>, String> {
    let variables = json!({ "fetch_status_metadata": false, "fetch_wamo_sub": false });
    let data = query(
        client,
        MexRequest::new(
            fetch_all_newsletters_metadata::NAME,
            fetch_all_newsletters_metadata::DOC_ID,
            variables,
        ),
    )
    .await?;
    let list = data["xwa2_newsletter_subscribed"]
        .as_array()
        .ok_or("missing xwa2_newsletter_subscribed array")?;
    // One entry that cannot be read must not hide the rest.
    Ok(list.iter().filter_map(|c| parse(c).ok()).collect())
}

/// Picture paths come without a host.
fn picture_url(path: &str) -> String {
    if path.starts_with("http") {
        path.to_string()
    } else {
        format!("https://pps.whatsapp.net{path}")
    }
}

fn parse(value: &Value) -> Result<NewsletterMetadata, String> {
    let jid: Jid = value["id"]
        .as_str()
        .ok_or("missing channel id")?
        .parse()
        .map_err(|e| format!("invalid channel id: {e}"))?;
    let thread = &value["thread_metadata"];
    let text = |v: &Value| v.as_str().filter(|s| !s.is_empty()).map(str::to_string);
    let number = |v: &Value| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    };
    Ok(NewsletterMetadata {
        jid,
        name: thread["name"]["text"].as_str().unwrap_or("").to_string(),
        description: text(&thread["description"]["text"]),
        subscriber_count: number(&thread["subscribers_count"]).unwrap_or(0),
        verification: if thread["verification"]
            .as_str()
            .is_some_and(|v| v.eq_ignore_ascii_case("verified"))
        {
            NewsletterVerification::Verified
        } else {
            NewsletterVerification::Unverified
        },
        state: NewsletterState::Active,
        picture_url: thread["picture"]["direct_path"].as_str().map(picture_url),
        preview_url: thread["preview"]["direct_path"].as_str().map(picture_url),
        invite_code: text(&thread["invite"]),
        role: value["viewer_metadata"]["role"].as_str().and_then(|r| {
            match r.to_ascii_lowercase().as_str() {
                "owner" => Some(NewsletterRole::Owner),
                "admin" => Some(NewsletterRole::Admin),
                "subscriber" => Some(NewsletterRole::Subscriber),
                "guest" => Some(NewsletterRole::Guest),
                _ => None,
            }
        }),
        creation_time: number(&thread["creation_time"]),
    })
}
