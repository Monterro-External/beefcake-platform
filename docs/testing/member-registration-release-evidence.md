# Member registration: release evidence example

The [acceptance scenarios](../../specs/member-registration.md) link each claim below to
an automated test and visible behaviour in its recording. Open the scenario in
the `playwright-acceptance-report` CI artifact to watch its video or inspect
the named steps in Trace Viewer. Videos display the current step and highlight
interactions; each scenario has its own recording.

| Release note claim | Scenario | Video chapter / named step | Visible evidence |
|---|---|---|---|
| Front desk can register a member with a plan, home site and access card. | A new member remains searchable with their subscription and access card | When the person is registered with a plan and access card | Registration succeeds and the profile displays Active, the selected plan, home site and card number. |
| A newly registered member can be found by email and reopened with their saved details. | A new member remains searchable with their subscription and access card | And the member can be found again with the saved details | Member search returns the new member; their profile retains the details after reopening and reloading. |
| An email already used at the same tenant is rejected with an explanation. | A duplicate email is rejected without changing existing records | Then the duplicate is explained and nothing is created or changed | The registration form displays the duplicate-email error instead of opening a new profile. |
| Two tenants can register the same email while access to the member profiles remains tenant-scoped. | Registrations using the same email remain isolated between tenants | And Puls Träning can find and access only its own member; And Nordic Fitness Group can find and access only its own member | Each tenant's search returns its own member; opening the other tenant's member URL shows 404. |

## Additional automated checks

The tests also verify subscription dates and stored identifiers, exactly one
queued welcome message, no extra records after rejection, and unchanged records
in the first tenant after the second tenant registers the same email. These are
database assertions in the test report, not visual evidence from the application.

## Current enforcement

CI fails when a scenario assertion fails or a required scenario, video, trace or
timeline is missing. It retains evidence for successful and failed scenarios and
updates a PR comment with the linked Spec's scenarios and generated video timestamps.
This table is reviewed manually; CI does not validate arbitrary release-note
claims or their visual coverage. See [the PR workflow](pr-evidence.md).
