# API Token Authentication And Authorization

## Summary

Implement a complete API token system for NOJV. Token creation, hashing, expiry,
rotation, and revocation use one shared lifecycle, while endpoint access is
controlled by a middleware-level whitelist, token scopes, and the token owner's
existing role/domain permissions.

This work builds on the public/internal API documentation split. Documentation
visibility does not automatically grant token access: only endpoints explicitly
listed in the token whitelist may accept Bearer token authentication.

## Key Decisions

- API tokens use a shared lifecycle for all users and API surfaces.
- Token access is controlled by three layers:
  - endpoint whitelist: whether the route accepts Bearer token auth;
  - scope check: whether the token has the required scope;
  - owner permission: whether the token owner has the required role/domain access.
- Public and internal APIs can both be represented in the whitelist.
- Internal APIs remain session-authenticated unless explicitly allowlisted for
  token auth.
- Existing browser-session APIs keep CSRF-style protection. Bearer-token requests
  may bypass `X-Requested-With: fetch` only when the route is token-whitelisted.
- Token management is exposed from the account area, e.g. `/account/api-tokens`.
- Expiry presets are 30 days, 90 days default, and 1 year.

## Token Model

Add an API token data model that stores only secure token metadata:

- owner user id;
- display name;
- token prefix for lookup;
- token hash;
- scopes;
- status;
- expiry time;
- last used time and IP;
- created, updated, revoked metadata.

Plaintext tokens are shown only once after creation or rotation. Raw token
secrets are never stored.

Token format should be opaque and prefix-addressable, for example:

```text
nojv_live_<prefix>.<secret>
```

## Authorization Model

Add a token-aware authorization layer that can answer:

```text
Can this token call this method/path?
```

The authorization flow should be:

1. Parse `Authorization: Bearer <token>`.
2. Match request method/path against the token route whitelist.
3. Reject token auth if the endpoint is not allowlisted.
4. Look up the token by prefix.
5. Hash and constant-time compare the presented token.
6. Reject revoked or expired tokens.
7. Load the token owner and map them to the existing actor shape.
8. Check required token scope.
9. Check required platform role when configured.
10. Let existing domain-level permission checks enforce object-level access.

The ACL/whitelist layer should stay coarse-grained. Existing domain permissions
remain responsible for checks such as problem author, contest organizer, course
staff, submission owner, or admin-only access.

## Token Route Whitelist

Define a centralized token whitelist entry shape:

```ts
{
  method: string;
  path: string;
  visibility: "public" | "internal";
  requiredScope: string | null;
  requiredRole?: "student" | "teacher" | "admin";
}
```

The first implementation should include only routes that are intentionally
approved for token access. Public docs should align with public whitelist
entries. Internal docs may contain more endpoints than the token whitelist.

## Token Management UI

Add user-facing token management under the account area.

Supported actions:

- create token;
- list tokens;
- update token name;
- update token scopes;
- update token expiry;
- rotate token;
- revoke token.

The list view should show token metadata such as name, prefix, scopes, status,
created time, expiry time, last used time, and last used IP. The plaintext token
is shown only immediately after create or rotate.

## OpenAPI Updates

Update public/internal OpenAPI documents after token auth is implemented:

- add Bearer token security scheme;
- mark token-enabled endpoints with required scopes;
- document which endpoints are public vs internal;
- keep internal-only session endpoints documented as session-authenticated when
  they are not token-whitelisted.

## Test Plan

- Token creation returns plaintext once and stores only hash/prefix.
- Valid token can call a whitelisted endpoint with the required scope.
- Missing, malformed, expired, revoked, or invalid tokens return 401.
- Valid token without required scope returns 403.
- Valid token owned by a user without required role/domain permission returns 403.
- Token cannot call non-whitelisted internal endpoints.
- Session-authenticated internal APIs continue to require existing CSRF-style
  protection.
- Bearer-token requests bypass CSRF-style header checks only for whitelisted
  token routes.
- Rotation invalidates the previous token secret.
- Revocation immediately disables the token.
- `lastUsedAt` and `lastUsedIp` update after successful token use.

## Assumptions

- Token management is available to signed-in users from the account area.
- Expiry is required in the first version; there is no never-expiring token
  option.
- Public/internal documentation split already exists and remains documentation
  focused.
- Token access is opt-in per endpoint through the whitelist.
