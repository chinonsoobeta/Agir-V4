# SSO, SAML, and SCIM Runbook

## SAML Setup

1. Create an enterprise application in the customer's IdP.
2. Configure callback/entity IDs according to the active auth provider.
3. Exchange SAML metadata URL or XML with the customer.
4. Store provider name and metadata URL in workspace compliance settings.
5. Test login with a non-admin pilot user.
6. Enforce SSO only after break-glass owner access is verified.

## SCIM Setup

1. Create the SCIM application in the IdP.
2. Generate a scoped provisioning token.
3. Map IdP groups to Agir roles: owner, admin, member, viewer.
4. Test create, update, deactivate, and group-change flows.
5. Enable `scim_enabled` in workspace compliance settings.
6. Record evidence in the customer implementation ticket.

## Break-Glass

- Keep at least two workspace owners.
- Owner changes require owner authority.
- Break-glass accounts must be reviewed quarterly.

## External Dependencies

- Production auth provider support for SAML/SCIM.
- Customer IdP administrator.
- Contractual role/group mapping approval.
