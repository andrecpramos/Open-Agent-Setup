# Breaking and non-breaking changes

A change is breaking if **any** existing, correctly written client can fail because of it.
When unsure, treat it as breaking and ask.

## HTTP / JSON

| Change | Breaking? | Notes |
|---|---|---|
| Add an endpoint | No | |
| Add an optional request field | No | |
| Add a response field | Usually no | Breaks clients that validate strictly or map to closed types — know your consumers |
| Add a value to a response enum | **Often yes** | Generated clients with closed enums throw on unknown values; document that enums are open, and make clients tolerant |
| Add a required request field | **Yes** | Make it optional with a default instead |
| Remove or rename a field | **Yes** | Deprecate, keep populating, remove in a new version |
| Change a field's type or format | **Yes** | Includes number → string, date format, nullability (non-null → nullable breaks readers) |
| Make validation stricter | **Yes** | Previously accepted requests now fail |
| Make validation looser | Usually no | |
| Change a status code or error code | **Yes** | Clients branch on them |
| Change default page size, sort order, or filter semantics | **Yes** | Silent behavioural change |
| Change authentication or required scopes | **Yes** | |
| Change rate limits downward | Effectively yes | Announce it |

## GraphQL

| Change | Breaking? |
|---|---|
| Add a type, a field, an optional argument | No |
| Add a required argument | Yes |
| Remove a field/type (without `@deprecated` period) | Yes |
| Change a field type; nullable → non-null on an input | Yes |
| Non-null → nullable on an output field | Yes for clients that assumed presence |
| Add an enum value | Yes for exhaustive client handling |

Deprecate with `@deprecated(reason: "Use X")`, monitor field usage, remove later.

## Protobuf / gRPC

- Never reuse or change a field number; mark removed fields `reserved` (numbers and names).
- Changing a field's type is breaking (with narrow wire-compatible exceptions — don't rely on
  them casually).
- Adding a field is safe; renaming is wire-safe but breaks generated code and JSON mapping.
- Adding an enum value is wire-safe; old clients see the unknown value — ensure a `*_UNSPECIFIED = 0` default.

## Events and messages

Events are an API too. Consumers may lag by days and replay history:

- Add fields; never remove or repurpose them within a version.
- Version the event type (`order.placed.v2`) for breaking changes and publish both during
  migration.
- Consumers ignore unknown fields.

## Deprecation playbook

1. Mark it deprecated in the spec, with the replacement and a date.
2. Emit `Deprecation`/`Sunset` headers (HTTP) or `@deprecated` (GraphQL).
3. Measure usage of the deprecated surface; identify the callers.
4. Communicate the date in the changelog and to known consumers.
5. Remove only when usage is zero or the date has passed **and** the user confirms.
