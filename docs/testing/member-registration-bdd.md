# Member registration

## Change summary

Adds BDD-based browser verification for member registration, duplicate rejection
and tenant isolation. Pull requests run the scenarios automatically and receive
a BDD-based description with test results, timestamps and links to recorded
clicks, traces and the HTML report. Registration behaviour in the application
is unchanged.

## Acceptance scenarios

- **AS-1 (happy path)**: Given a front desk user at Puls Träning and a person with valid contact details whose email is not registered with that tenant, When the person is registered with a plan, home site and access card, Then the member is searchable, has an active subscription for the selected plan and home site, has an access card and exactly one queued welcome message, and those details remain available on subsequent visits.
- **AS-2 (error case)**: Given an email address already belongs to a member at Puls Träning, When another registration uses that email address at the same tenant, Then the registration is rejected with an explanation, the existing member remains unchanged, and no additional member, subscription, access card or welcome message is created.
- **AS-3 (regression)**: Given two tenants with separate member records, When the same email address is registered with both tenants, Then each tenant has its own member, subscription and access card, the first tenant's records remain unchanged, and each tenant continues to find and access only its own member records.
