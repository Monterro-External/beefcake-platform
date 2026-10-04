# Member registration (fixture)

A Spec issue's description, as the PR evidence job reads it from Linear.


```gherkin
@registration
Feature: Member registration

  @happy
  Scenario: AS-1 A new member remains searchable with their subscription and access card
    Given a front desk user at Puls Träning
    And a person with valid contact details whose email is not registered with that tenant
    When the person is registered with a plan, home site and access card
    Then the member has an active subscription for the selected plan and home site
    And the member has an access card
    And the member can be found again with the saved details on later visits
    And exactly one welcome message is queued

  @error
  Scenario: AS-2 A duplicate email is rejected without changing existing records
    Given an email address already belongs to a member at Puls Träning
    When another registration uses that email address at the same tenant
    Then the registration is rejected with an explanation
    And the existing member is unchanged
    And no member, subscription, access card or welcome message is created

  @regression
  Scenario: AS-3 Registrations using the same email remain isolated between tenants
    Given a member registered with Nordic Fitness Group
    When Puls Träning registers a member with the same email address
    Then each tenant has its own member, subscription and access card
    And the first tenant's records are unchanged
    And each tenant can find and open only its own member
```

