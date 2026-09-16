# Hammered Handyman newsletter reward integration

This build adds a one-time 25-credit Chad reward flow for subscribers coming from HammeredHandyman.com.

## Required Chad hosting environment variable

Create a long random secret and add it to ChadPDChee hosting as:

HH_REWARDS_SECRET=<your-random-secret>

Use the exact same value in WordPress -> Settings -> Hammered Mailing List -> Chad Rewards Secret.
Never put this secret in public JavaScript.

## How claiming works

HammeredHandyman.com requests a one-time reward code for the subscriber email.
The SendFox welcome email receives a unique `chad_reward_url` custom field.
When the subscriber follows it, Chad asks them to sign in/create an account. The reward can only be redeemed by a Chad account using the same email address.
The 25 credits are written to Chad's existing chat-credit ledger with entry_type `promotion`.

## Chad's Picks reliability change

For physical DIY/diagnostic questions, if the normal combined enrichment returns zero verified Amazon products, Chad now performs one dedicated verified-product research fallback. It still rejects unverified/fabricated ASINs and does not force products into non-physical questions.
