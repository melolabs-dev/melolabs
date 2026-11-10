# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## v2.0.8

[compare changes](https://github.com/h3js/h3/compare/v2.0.7...v2.0.8)

### 🩹 Fixes

- **rules:** Let `HTTPError.headers` opt out of `headers` rule on errors ([#1613](https://github.com/h3js/h3/pull/1613))

### ❤️ Contributors

- Pi0x <x@pi0.io>

## v2.0.7

[compare changes](https://github.com/h3js/h3/compare/v2.0.6...v2.0.7)

### 🩹 Fixes

- Keep middleware-staged headers out of handler-level caches ([#1608](https://github.com/h3js/h3/pull/1608))

### ❤️ Contributors

- Pi0x <x@pi0.io>

## v2.0.6

[compare changes](https://github.com/h3js/h3/compare/v2.0.5...v2.0.6)

### 🩹 Fixes

- **rules:** Fill target `**` for named catch-all keys (`/**:name`) ([48d650b](https://github.com/h3js/h3/commit/48d650b))
- **rules:** Keep middleware-staged headers out of `cache` entries ([#1606](https://github.com/h3js/h3/pull/1606))

### ❤️ Contributors

- Pi0x <x@pi0.io>
- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.5

[compare changes](https://github.com/h3js/h3/compare/v2.0.4...v2.0.5)

### 🩹 Fixes

- **cli:** Harden `h3 docs` page handling ([7150b0e](https://github.com/h3js/h3/commit/7150b0e))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>

## v2.0.4

[compare changes](https://github.com/h3js/h3/compare/v2.0.3...v2.0.4)

### 📦 Build

- Remove bundled docs and open h3.dev from `h3 docs` ([#1602](https://github.com/h3js/h3/pull/1602))

### 🏡 Chore

- Update srvx ([1a1f488](https://github.com/h3js/h3/commit/1a1f488))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>

## v2.0.3

[compare changes](https://github.com/h3js/h3/compare/v2.0.2...v2.0.3)

### 🩹 Fixes

- **body:** Match form content type case-insensitively in `readBody` ([#1601](https://github.com/h3js/h3/pull/1601))
- **static:** Serve `.wasm` as `application/wasm` ([#1581](https://github.com/h3js/h3/pull/1581))
- **static:** Match file extensions case-insensitively ([#1580](https://github.com/h3js/h3/pull/1580))
- **sse:** Preserve empty event ids ([#1590](https://github.com/h3js/h3/pull/1590))
- **query:** Decode valid escapes next to a malformed one ([#1582](https://github.com/h3js/h3/pull/1582))
- **response:** Omit HEAD body for default errors ([#1595](https://github.com/h3js/h3/pull/1595))
- **tracing:** Mount nested apps passed to `use()` ([#1576](https://github.com/h3js/h3/pull/1576))
- **cors:** Make stateful origin regex checks repeatable ([#1589](https://github.com/h3js/h3/pull/1589))

### 📖 Documentation

- Fix code example ([#1587](https://github.com/h3js/h3/pull/1587))
- Fix broken section anchors ([#1577](https://github.com/h3js/h3/pull/1577))

### 🏡 Chore

- Apply automated updates ([7b5090e](https://github.com/h3js/h3/commit/7b5090e))
- Update deps ([d37911d](https://github.com/h3js/h3/commit/d37911d))

### ✅ Tests

- Accept exact loopback addresses in fingerprint checks ([#1588](https://github.com/h3js/h3/pull/1588))

### ❤️ Contributors

- Huanyi Xie ([@xiehuanyi](https://github.com/xiehuanyi))
- Pooya Parsa <pooya@pi0.io>
- Rabari Mihir ([@Mihir-Rabari](https://github.com/Mihir-Rabari))
- Liu Jie ([@maxazure](https://github.com/maxazure))
- Harshit Prakash ([@harshit-d3v](https://github.com/harshit-d3v))
- Satvik Mishra
- Otowa1
- Paul Nguyen

## v2.0.2

[compare changes](https://github.com/h3js/h3/compare/v2.0.1...v2.0.2)

### 🩹 Fixes

- **node:** Call `onError` for stream errors in Node.js handlers ([#1571](https://github.com/h3js/h3/pull/1571))
- **response:** Use matching reason phrases in redirect and noContent ([#1570](https://github.com/h3js/h3/pull/1570))
- **middleware:** Pass through handled responses in `onError` ([#1574](https://github.com/h3js/h3/pull/1574))

### 📖 Documentation

- Add v2 blog article ([9adeeee](https://github.com/h3js/h3/commit/9adeeee))

### 🌊 Types

- **session:** Remove `@ts-nocheck` from iron-crypto ([#1572](https://github.com/h3js/h3/pull/1572))
- **route:** Infer `defineRoute` handler input from validation schemas ([ec527f0](https://github.com/h3js/h3/commit/ec527f0))

### 🏡 Chore

- **session:** Retarget legacy seal fallback removal to v3 ([#1573](https://github.com/h3js/h3/pull/1573))
- **session:** Mark `legacySealFallback` as deprecated ([44dbfb8](https://github.com/h3js/h3/commit/44dbfb8))
- Update deps ([ac79e5f](https://github.com/h3js/h3/commit/ac79e5f))
- Update release script ([07d7d2c](https://github.com/h3js/h3/commit/07d7d2c))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>
- Bao Nguyen ([@giaBaoJS](https://github.com/giaBaoJS))
- Kaan Çelebi ([@kaanisthatyou](https://github.com/kaanisthatyou))
- Daniel Shafer ([@dannyshafer](https://github.com/dannyshafer))

## v2.0.1-rc.33

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.32...v2.0.1-rc.33)

### 🚀 Enhancements

- **rules:** Skip `redirect` when the request is already at the target ([#1559](https://github.com/h3js/h3/pull/1559))

### 🩹 Fixes

- **cookie:** Include partitioned in the distinct-cookie key ([#1553](https://github.com/h3js/h3/pull/1553))
- **sse:** Preserve buffered events during overlapping flushes ([#1555](https://github.com/h3js/h3/pull/1555))
- **static:** Set vary header when a single encoding is accepted ([#1556](https://github.com/h3js/h3/pull/1556))
- **static:** Honor q-values and case in accept-encoding ([#1560](https://github.com/h3js/h3/pull/1560))
- **mime:** Add .mjs and .cjs to COMMON_MIME_TYPES ([#1566](https://github.com/h3js/h3/pull/1566))
- **rules:** Normalize rule keys like routes and tighten the shape guard ([7cbf21c](https://github.com/h3js/h3/commit/7cbf21c))
- **rules:** Let a narrower pattern reinstate a rule reset on another reading ([3f1c9e5](https://github.com/h3js/h3/commit/3f1c9e5))
- **rules:** Allow `headers: false` in RouteRuleConfig ([edcc329](https://github.com/h3js/h3/commit/edcc329))
- **validate:** Preserve repeated query values in defineValidatedHandler ([#1562](https://github.com/h3js/h3/pull/1562))
- **cookie:** Size cookie chunks by their encoded length ([#1565](https://github.com/h3js/h3/pull/1565))
- **static:** Resolve the MIME type of a precompressed variant from the requested asset ([#1564](https://github.com/h3js/h3/pull/1564))
- **mount:** Reject `//` after base ([1161eb7](https://github.com/h3js/h3/commit/1161eb7))
- **session:** Keep loaded session data prototype-free ([46bc1a2](https://github.com/h3js/h3/commit/46bc1a2))

### 💅 Refactors

- Update rou3 to v0.10 ([3cfd749](https://github.com/h3js/h3/commit/3cfd749))

### 📖 Documentation

- Document raw query access via event.url.search ([#1551](https://github.com/h3js/h3/pull/1551))

### 🌊 Types

- **auth:** BasicAuth context fields are always set ([#1550](https://github.com/h3js/h3/pull/1550))

### 🏡 Chore

- Udate deps ([8f21c71](https://github.com/h3js/h3/commit/8f21c71))
- Update rou3 to v1 ([6d59f61](https://github.com/h3js/h3/commit/6d59f61))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Breken <support@brekfuz.com>
- 00200200 ([@00200200](https://github.com/00200200))
- Okxint ([@okxint](https://github.com/okxint))
- Pi0x <x@pi0.io>
- Alexandre Kohler ([@kwy404](https://github.com/kwy404))
- Maxim Gagiev <maximgagievv@gmail.com>
- Kauê Leivingson ([@Kaue-TecsaGroup](https://github.com/Kaue-TecsaGroup))
- Geonseok ([@hxperl](https://github.com/hxperl))
- Oskar Lebuda ([@OskarLebuda](https://github.com/OskarLebuda))

## v2.0.1-rc.32

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.30...v2.0.1-rc.32)

### 🚀 Enhancements

- **rules:** Support non-trailing `**` in redirect/proxy targets ([228bca3](https://github.com/h3js/h3/commit/228bca3))
- Export `normalizeRoute` as a public path utility ([#1549](https://github.com/h3js/h3/pull/1549))

### 🔥 Performance

- **rules:** Evict memoized matches with SIEVE instead of FIFO ([#1543](https://github.com/h3js/h3/pull/1543))

### 🩹 Fixes

- **route-rules:** Pass uncacheable requests through the cache rule ([b6c7d08](https://github.com/h3js/h3/commit/b6c7d08))
- Handle srvx body limit errors as 413 ([b5d20d5](https://github.com/h3js/h3/commit/b5d20d5))
- **error:** Require `status` in `HTTPError.isError` ([e6b726b](https://github.com/h3js/h3/commit/e6b726b))

### 📦 Build

- Export `TypedHeaders` type ([#1547](https://github.com/h3js/h3/pull/1547))

### 🌊 Types

- **handler:** Infer route handler request type instead of any ([#1546](https://github.com/h3js/h3/pull/1546))
- **handler:** Use request header names for `req.headers` ([ae529f1](https://github.com/h3js/h3/commit/ae529f1))

### 🏡 Chore

- Apply automated updates ([c460ebe](https://github.com/h3js/h3/commit/c460ebe))
- Update deps ([1316ffb](https://github.com/h3js/h3/commit/1316ffb))
- Apply automated updates ([21a26d9](https://github.com/h3js/h3/commit/21a26d9))
- Update lockfile ([00c0d3f](https://github.com/h3js/h3/commit/00c0d3f))
- Apply automated updates ([6075f8a](https://github.com/h3js/h3/commit/6075f8a))
- **release:** V2.0.1-rc.31 ([df811cd](https://github.com/h3js/h3/commit/df811cd))
- Update lockfile ([bae31f3](https://github.com/h3js/h3/commit/bae31f3))
- Apply automated updates ([7f5f106](https://github.com/h3js/h3/commit/7f5f106))
- Update deps ([a5fdc86](https://github.com/h3js/h3/commit/a5fdc86))
- Update deps ([60d883f](https://github.com/h3js/h3/commit/60d883f))

### 🤖 CI

- Replace setup-node and corepack with setup-jup ([#1544](https://github.com/h3js/h3/pull/1544))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>
- Rith Banerjee ([@Rithb898](https://github.com/Rithb898))
- Lazizbek Ergashev ([@lazerg](https://github.com/lazerg))

## v2.0.1-rc.31

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.30...v2.0.1-rc.31)

### 🚀 Enhancements

- **rules:** Support non-trailing `**` in redirect/proxy targets ([228bca3](https://github.com/h3js/h3/commit/228bca3))

### 🔥 Performance

- **rules:** Evict memoized matches with SIEVE instead of FIFO ([#1543](https://github.com/h3js/h3/pull/1543))

### 🏡 Chore

- Apply automated updates ([c460ebe](https://github.com/h3js/h3/commit/c460ebe))
- Update deps ([1316ffb](https://github.com/h3js/h3/commit/1316ffb))
- Apply automated updates ([21a26d9](https://github.com/h3js/h3/commit/21a26d9))
- Update lockfile ([00c0d3f](https://github.com/h3js/h3/commit/00c0d3f))

### 🤖 CI

- Replace setup-node and corepack with setup-jup ([#1544](https://github.com/h3js/h3/pull/1544))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>

## v2.0.1-rc.30

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.29...v2.0.1-rc.30)

### 🩹 Fixes

- **cli:** Resolve docs directory to file system path with fileURLToPath ([#1540](https://github.com/h3js/h3/pull/1540))
- **cli:** Spawn docs command without a shell ([04a78a0](https://github.com/h3js/h3/commit/04a78a0))
- **session:** Do not persist a session that is only read ([#1541](https://github.com/h3js/h3/pull/1541))

### 💅 Refactors

- **core:** Compose route middleware in the dispatcher ([#1533](https://github.com/h3js/h3/pull/1533))

### 🌊 Types

- **handler:** Expose validated query/headers on validated hander type ([#1538](https://github.com/h3js/h3/pull/1538))

### 🏡 Chore

- Fix docs link ([1892ee9](https://github.com/h3js/h3/commit/1892ee9))
- Update srvx to v1 ([81440ec](https://github.com/h3js/h3/commit/81440ec))
- Update deps ([2364d46](https://github.com/h3js/h3/commit/2364d46))
- Pin node to 24 ([5797f6d](https://github.com/h3js/h3/commit/5797f6d))
- Update release script ([2c9b2f9](https://github.com/h3js/h3/commit/2c9b2f9))

### ✅ Tests

- **cli:** Assert docs command spawns without a shell ([07273db](https://github.com/h3js/h3/commit/07273db))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Dương Ngọc Anh <duongngocanh2k03@gmail.com>
- Pi0x <x@pi0.io>
- Liang Xu <755674130@qq.com>
- Daniel Roe ([@danielroe](https://github.com/danielroe))

## v2.0.1-rc.29

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.28...v2.0.1-rc.29)

### 🩹 Fixes

- **ws:** Keep WebSocket hooks reachable when the response is rebuilt ([3a57939](https://github.com/h3js/h3/commit/3a57939))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.1-rc.28

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.27...v2.0.1-rc.28)

### 🩹 Fixes

- **static:** Keep a leading separator run from bypassing a route guard ([f3e4c46](https://github.com/h3js/h3/commit/f3e4c46))
- **proxy:** Strip tab/LF/CR from internal proxy targets ([ffd9620](https://github.com/h3js/h3/commit/ffd9620))
- **proxy:** Do not include upstream failure message in gateway error ([936f14b](https://github.com/h3js/h3/commit/936f14b))
- **response:** Normalize values thrown from the onError hook ([2d6a10a](https://github.com/h3js/h3/commit/2d6a10a))
- **response:** Detect `HTTPResponse` by brand instead of `constructor.name` ([0bbcbc4](https://github.com/h3js/h3/commit/0bbcbc4))
- **fromNodeHandler:** Don't hang the event when a piped client disconnects ([373e32a](https://github.com/h3js/h3/commit/373e32a))
- **handler:** Run middleware for object syntax with fetch ([cf7e585](https://github.com/h3js/h3/commit/cf7e585))
- **response:** Call the `onError` hook again ([f176b35](https://github.com/h3js/h3/commit/f176b35))
- **static:** Refuse a non-canonical pathname instead of resolving it ([baef4b9](https://github.com/h3js/h3/commit/baef4b9))

### 📖 Documentation

- Rewrite route rules ([abd4d77](https://github.com/h3js/h3/commit/abd4d77))
- **request:** Add security caveat for getRequestIP xForwardedFor ([b09eda1](https://github.com/h3js/h3/commit/b09eda1))

### 🏡 Chore

- Apply automated updates ([a98d6d6](https://github.com/h3js/h3/commit/a98d6d6))
- Apply automated updates ([449aa7f](https://github.com/h3js/h3/commit/449aa7f))
- Update deps ([75fd2de](https://github.com/h3js/h3/commit/75fd2de))
- Lint ([f05b374](https://github.com/h3js/h3/commit/f05b374))
- Update deps ([71715ce](https://github.com/h3js/h3/commit/71715ce))

### ✅ Tests

- Bump bundle size ([bd5cd6a](https://github.com/h3js/h3/commit/bd5cd6a))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.1-rc.27

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.26...v2.0.1-rc.27)

### 🚀 Enhancements

- Route rules ([#1524](https://github.com/h3js/h3/pull/1524))
- **session:** Add opt-in `idleTimeout` for sliding expiration ([#1513](https://github.com/h3js/h3/pull/1513))

### 🩹 Fixes

- **session:** Encode large payloads outside node-compatible runtimes ([#1515](https://github.com/h3js/h3/pull/1515))
- **event:** ⚠️ Decode only needless escapes in the pathname ([#1526](https://github.com/h3js/h3/pull/1526))
- **middleware:** Match use() route filters with rou3 ([d9d3124](https://github.com/h3js/h3/commit/d9d3124))
- **response:** Sanitize status and statusText ([8e69593](https://github.com/h3js/h3/commit/8e69593))
- Normalize route patterns as pathnames ([cbd5c73](https://github.com/h3js/h3/commit/cbd5c73))
- **middleware:** Compare method scopes case-insensitively ([850f25c](https://github.com/h3js/h3/commit/850f25c))
- **request:** Compare methods case-insensitively in isMethod ([#1528](https://github.com/h3js/h3/pull/1528))
- **proxy:** Keep internal targets on the app origin ([07d22ec](https://github.com/h3js/h3/commit/07d22ec))
- **json-rpc:** ⚠️ Require JSON content-type, validate origin and cap batch size ([72d8e05](https://github.com/h3js/h3/commit/72d8e05))
- **fingerprint:** ⚠️ Default to SHA-256 and disambiguate components ([51e68cd](https://github.com/h3js/h3/commit/51e68cd))
- **cookie:** Keep unparseable set-cookie headers when merging ([175ba5c](https://github.com/h3js/h3/commit/175ba5c))
- **static:** Keep encoded backslashes opaque in the asset id ([ab3f23c](https://github.com/h3js/h3/commit/ab3f23c))
- **request:** Keep the request proxy cache from shadowing real properties ([c71f5c0](https://github.com/h3js/h3/commit/c71f5c0))
- **proxy:** ⚠️ Xfwd must not let client `x-forwarded-*` headers win ([0c7429e](https://github.com/h3js/h3/commit/0c7429e))
- **response:** Keep prepared headers from accumulating on reused Responses ([9f766d9](https://github.com/h3js/h3/commit/9f766d9))
- **request:** Keep a malformed x-forwarded-host from stripping the real port ([429b994](https://github.com/h3js/h3/commit/429b994))
- **request:** ⚠️ Keep the host header from steering the synthesized URL ([2b59a3a](https://github.com/h3js/h3/commit/2b59a3a))
- **rules:** Keep a route-scoped cache rule from deadlocking the request ([484ec58](https://github.com/h3js/h3/commit/484ec58))
- **route:** Keep removeRoute from unregistering sibling routes ([94d0edd](https://github.com/h3js/h3/commit/94d0edd))

### 📖 Documentation

- Clarify getRouterParams decode is a single pass ([44621f3](https://github.com/h3js/h3/commit/44621f3))
- **rules:** Cache rule ends the global middleware chain on misses too ([9f3eea3](https://github.com/h3js/h3/commit/9f3eea3))

### 📦 Build

- Prevent malformed pathname guard from being tree-shaken ([fa00775](https://github.com/h3js/h3/commit/fa00775))

### 🏡 Chore

- Apply automated updates ([cbb3063](https://github.com/h3js/h3/commit/cbb3063))
- Update undocs ([502c59f](https://github.com/h3js/h3/commit/502c59f))
- Fix types ([2dbb9f3](https://github.com/h3js/h3/commit/2dbb9f3))
- Update undocs ([176e507](https://github.com/h3js/h3/commit/176e507))
- Update undocs ([dd993c4](https://github.com/h3js/h3/commit/dd993c4))
- Update undocs ([7ab53b2](https://github.com/h3js/h3/commit/7ab53b2))
- Update undocs ([d60b5e0](https://github.com/h3js/h3/commit/d60b5e0))
- Update undocs ([9ef8ec2](https://github.com/h3js/h3/commit/9ef8ec2))
- Update undocs ([0f987dd](https://github.com/h3js/h3/commit/0f987dd))
- Update docs lock ([c040817](https://github.com/h3js/h3/commit/c040817))
- Update undocs ([50b00d2](https://github.com/h3js/h3/commit/50b00d2))
- Update undocs ([5e8a317](https://github.com/h3js/h3/commit/5e8a317))
- Update gitignore ([7e4ce44](https://github.com/h3js/h3/commit/7e4ce44))
- Update deps ([516444b](https://github.com/h3js/h3/commit/516444b))
- Apply automated updates ([55335c5](https://github.com/h3js/h3/commit/55335c5))
- Apply automated updates ([0da4bf0](https://github.com/h3js/h3/commit/0da4bf0))
- Bump bundle ([957dbe6](https://github.com/h3js/h3/commit/957dbe6))

### 🤖 CI

- Harden workflows ([#1529](https://github.com/h3js/h3/pull/1529))

#### ⚠️ Breaking Changes

- **event:** ⚠️ Decode only needless escapes in the pathname ([#1526](https://github.com/h3js/h3/pull/1526))
- **json-rpc:** ⚠️ Require JSON content-type, validate origin and cap batch size ([72d8e05](https://github.com/h3js/h3/commit/72d8e05))
- **fingerprint:** ⚠️ Default to SHA-256 and disambiguate components ([51e68cd](https://github.com/h3js/h3/commit/51e68cd))
- **proxy:** ⚠️ Xfwd must not let client `x-forwarded-*` headers win ([0c7429e](https://github.com/h3js/h3/commit/0c7429e))
- **request:** ⚠️ Keep the host header from steering the synthesized URL ([2b59a3a](https://github.com/h3js/h3/commit/2b59a3a))

### ❤️ Contributors

- Shree Bohara ([@ShreeBohara](https://github.com/ShreeBohara))
- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>
- Vijay Misal ([@vjymisal0](https://github.com/vjymisal0))
- Jayesh Bhade ([@Jaybhade](https://github.com/Jaybhade))

## v2.0.1-rc.26

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.25...v2.0.1-rc.26)

### 🚀 Enhancements

- **resolveDotSegments:** Add `mergeSlashes` option ([9581407](https://github.com/h3js/h3/commit/9581407))
- **session:** Default session cookie to SameSite=Lax ([acf8d77](https://github.com/h3js/h3/commit/acf8d77))
- ⚠️ Escape interpolated values in `html` tagged template ([#1459](https://github.com/h3js/h3/pull/1459))
- **readValidatedBody:** Support readBody options ([#1476](https://github.com/h3js/h3/pull/1476))
- Add `onDispose` hook ([#1488](https://github.com/h3js/h3/pull/1488))
- **defineValidatedHandler:** Support async validation ([#1491](https://github.com/h3js/h3/pull/1491))
- **sse:** Allow returning EventStream directly from handlers ([#1508](https://github.com/h3js/h3/pull/1508))

### 🔥 Performance

- Single-scan fast-path guard for `resolveDotSegments` ([#1458](https://github.com/h3js/h3/pull/1458))
- **cookie:** Avoid quadratic chunked cookie parsing and header rebuilds ([#1472](https://github.com/h3js/h3/pull/1472))
- **middleware:** Precompose middleware chains ([#1475](https://github.com/h3js/h3/pull/1475))
- **body-limit:** Stream enforcement instead of pre-buffering ([#1500](https://github.com/h3js/h3/pull/1500))

### 🩹 Fixes

- **resolveDotSegments:** Preserve trailing slash on trailing dot segments ([ca7de07](https://github.com/h3js/h3/commit/ca7de07))
- **cookie:** Dedup cookies with leading-dot / mixed-case domains ([#1462](https://github.com/h3js/h3/pull/1462))
- **cors:** Warn on credentials with `null` origin ([#1464](https://github.com/h3js/h3/pull/1464))
- Decode Basic-auth credentials as UTF-8 ([#1463](https://github.com/h3js/h3/pull/1463))
- **proxy:** ForwardHeaders must not override framing headers ([#1467](https://github.com/h3js/h3/pull/1467))
- **cookie:** Cap chunk count in setChunkedCookie ([#1469](https://github.com/h3js/h3/pull/1469))
- **cors:** Set single-valued CORS headers instead of appending ([#1466](https://github.com/h3js/h3/pull/1466))
- **auth:** Harden basic-auth realm handling and credential timing ([#1468](https://github.com/h3js/h3/pull/1468))
- **validate:** Convert malformed JSON to 400 in validated-handler path ([#1465](https://github.com/h3js/h3/pull/1465))
- **base:** Collapse leading-slash run in all base-stripping sites ([#1471](https://github.com/h3js/h3/pull/1471))
- **html:** Make raw() trust marker unforgeable and hoist escape map ([#1473](https://github.com/h3js/h3/pull/1473))
- **json-rpc:** Use `-32600` for valid-JSON non-object bodies ([#1483](https://github.com/h3js/h3/pull/1483))
- Only discard prepared headers for error responses ([#1486](https://github.com/h3js/h3/pull/1486))
- **event-stream:** Correct stream teardown on close and client disconnect ([#1484](https://github.com/h3js/h3/pull/1484))
- **deprecated:** Correct v1 signatures in the compat shim ([#1492](https://github.com/h3js/h3/pull/1492))
- **response:** Do not render non-Error throws as successful responses ([#1485](https://github.com/h3js/h3/pull/1485))
- **event:** Keep event.context and req.context as one reference ([#1499](https://github.com/h3js/h3/pull/1499))
- **response:** Absorb errors thrown in onResponse hook ([4a32c1b](https://github.com/h3js/h3/commit/4a32c1b))
- **response:** Route synchronous prepareResponse throws through the error pipeline ([#1503](https://github.com/h3js/h3/pull/1503))
- **response:** Keep content-length header for Uint8Array responses ([#1504](https://github.com/h3js/h3/pull/1504))
- **response:** Strip HEAD body when merging prepared headers into a mutable Response ([#1490](https://github.com/h3js/h3/pull/1490))
- **response:** Allow status and headers staged during the first stream chunk ([#1512](https://github.com/h3js/h3/pull/1512))

### 💅 Refactors

- **request:** ⚠️ Make x-forwarded-proto trust opt-in ([#1461](https://github.com/h3js/h3/pull/1461))
- **event-stream:** ⚠️ Drop `autoclose` option ([#1495](https://github.com/h3js/h3/pull/1495))
- **sse:** Promote EventStream to public API, deprecate createEventStream ([#1509](https://github.com/h3js/h3/pull/1509))

### 📖 Documentation

- Security caveats for cors, proxy, redirect, host and static utils ([#1470](https://github.com/h3js/h3/pull/1470))
- Explain `event.url.pathname` decoding ([3f8b5bc](https://github.com/h3js/h3/commit/3f8b5bc))

### 🌊 Types

- Canonical `RouteRules` interface ([#1474](https://github.com/h3js/h3/pull/1474))
- Remove unused `StaticAssetMeta.path` ([0b34e24](https://github.com/h3js/h3/commit/0b34e24))

### 🏡 Chore

- Apply automated updates ([3e74620](https://github.com/h3js/h3/commit/3e74620))
- Fix stale comment ([879c869](https://github.com/h3js/h3/commit/879c869))
- Update agents.md ([6444251](https://github.com/h3js/h3/commit/6444251))
- Add missing `H3Core` types ([978b17c](https://github.com/h3js/h3/commit/978b17c))
- Update deps ([199afe6](https://github.com/h3js/h3/commit/199afe6))
- Use normal tsc for typecheck ([7d70c6f](https://github.com/h3js/h3/commit/7d70c6f))
- Update srvx to 0.12 ([5eb0a01](https://github.com/h3js/h3/commit/5eb0a01))
- Update undocs ([ba42947](https://github.com/h3js/h3/commit/ba42947))
- Update docs ([50266f3](https://github.com/h3js/h3/commit/50266f3))
- Apply automated updates ([321b1dc](https://github.com/h3js/h3/commit/321b1dc))
- Update deps ([6e24eb3](https://github.com/h3js/h3/commit/6e24eb3))

#### ⚠️ Breaking Changes

- ⚠️ Escape interpolated values in `html` tagged template ([#1459](https://github.com/h3js/h3/pull/1459))
- **request:** ⚠️ Make x-forwarded-proto trust opt-in ([#1461](https://github.com/h3js/h3/pull/1461))
- **event-stream:** ⚠️ Drop `autoclose` option ([#1495](https://github.com/h3js/h3/pull/1495))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>
- N0liu ([@n0liu](https://github.com/n0liu))
- G1mn <beebird@gmail.com>
- Sandro Circi ([@sandros94](https://github.com/sandros94))
- Max ([@onmax](https://github.com/onmax))

## v2.0.1-rc.25

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.24...v2.0.1-rc.25)

### 🚀 Enhancements

- Proxy improvements ([#1455](https://github.com/h3js/h3/pull/1455))

### 🩹 Fixes

- **cors:** Correct vary handling and credentialed wildcard behavior ([#1456](https://github.com/h3js/h3/pull/1456))
- **session:** Raise default seal PBKDF2 iterations to 8192 ([#1457](https://github.com/h3js/h3/pull/1457))

### 🏡 Chore

- Apply automated updates ([3813e9b](https://github.com/h3js/h3/commit/3813e9b))
- Add missing `@__PURE__` annotations ([b17c451](https://github.com/h3js/h3/commit/b17c451))
- Update deps ([b1b4ce0](https://github.com/h3js/h3/commit/b1b4ce0))
- Apply automated updates ([e2c9648](https://github.com/h3js/h3/commit/e2c9648))
- Fix release script ([50c8a33](https://github.com/h3js/h3/commit/50c8a33))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Pi0x <x@pi0.io>

## v2.0.1-rc.24

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.22...v2.0.1-rc.24)

### 🚀 Enhancements

- **proxy:** Support client aborts ([#1417](https://github.com/h3js/h3/pull/1417))
- **ws:** Allow optional HTTP handling in defineWebSocketHandler ([#1425](https://github.com/h3js/h3/pull/1425))
- Export `resolveDotSegments` as a public path utility ([#1428](https://github.com/h3js/h3/pull/1428))
- **readBody:** Support formdata type ([#1164](https://github.com/h3js/h3/pull/1164))
- Add QUERY method support ([#1445](https://github.com/h3js/h3/pull/1445))
- Add `requireContentType` and `appendAcceptQuery` utils ([#1446](https://github.com/h3js/h3/pull/1446))
- Automatically match GET routes for HEAD requests ([#1452](https://github.com/h3js/h3/pull/1452))

### 🩹 Fixes

- **sanitizeStatusCode:** Return default for non-numeric input instead of NaN ([#1420](https://github.com/h3js/h3/pull/1420))
- **auth:** Reject Basic credentials with no colon separator ([#1393](https://github.com/h3js/h3/pull/1393))
- **sse:** Ignore pushes after stream close ([#1411](https://github.com/h3js/h3/pull/1411))
- **proxy:** Ignore incoming accept-encoding header ([#1423](https://github.com/h3js/h3/pull/1423))
- **cache:** HandleCacheHeaders ignores multi-value If-None-Match header ([#1395](https://github.com/h3js/h3/pull/1395))
- **serve-static:** Compare if-modified-since at whole-second precision ([#1394](https://github.com/h3js/h3/pull/1394))
- **request:** Parse first entry of comma-list x-forwarded-proto header ([#1413](https://github.com/h3js/h3/pull/1413))
- **serve-static:** Check the response (not request) for an existing content-length ([#1391](https://github.com/h3js/h3/pull/1391))
- **cors:** Merge Vary headers when both origin and allow-headers emit vary ([#1396](https://github.com/h3js/h3/pull/1396))
- **writeEarlyHints:** Normalize Link key to prevent hanging with Node.js ([#1385](https://github.com/h3js/h3/pull/1385))
- **event:** Return 400 for malformed percent-encoded request URLs ([#1424](https://github.com/h3js/h3/pull/1424))
- **mount:** Restore pathname on error with try/finally ([#1319](https://github.com/h3js/h3/pull/1319))
- **serve-static:** Decode the resolved id before lookup ([#1431](https://github.com/h3js/h3/pull/1431))
- **request:** Shadow parsed \_url in requestWithURL proxy ([d21d93c](https://github.com/h3js/h3/commit/d21d93c))
- **event:** Clone URL for pathname normalization instead of mutating shared \_url ([a1cf066](https://github.com/h3js/h3/commit/a1cf066))
- **adapters:** Sync raw node req.url with event.url in fromNodeHandler ([#1433](https://github.com/h3js/h3/pull/1433))
- **json-rpc:** Do not leak internal exception messages to clients ([ea2f2a3](https://github.com/h3js/h3/commit/ea2f2a3))
- **request:** Prevent decode:true from reintroducing path separators ([cd03d41](https://github.com/h3js/h3/commit/cd03d41))
- **handleCacheHeaders:** Correct conditional-request precedence and Cache-Control default ([#1454](https://github.com/h3js/h3/pull/1454))

### 💅 Refactors

- **validate:** Drop always-true `if (validate.body)` guard in body proxy ([#1392](https://github.com/h3js/h3/pull/1392))
- Leftover changes from #1428 ([#1430](https://github.com/h3js/h3/pull/1430), [#1428](https://github.com/h3js/h3/issues/1428))

### 📖 Documentation

- **proxy:** Add note about reading body ([7eb018e](https://github.com/h3js/h3/commit/7eb018e))
- Fix decode function name in router param helpers ([#1419](https://github.com/h3js/h3/pull/1419))
- **session:** Note secure cookie limitation over local HTTP ([#1409](https://github.com/h3js/h3/pull/1409))
- Document the session name option for multiple sessions ([#1405](https://github.com/h3js/h3/pull/1405))
- Add arkstack framework to community section ([#1382](https://github.com/h3js/h3/pull/1382))
- **ws:** Use zero-config crossws server plugin ([#1427](https://github.com/h3js/h3/pull/1427))
- Fix typos in response and handler guides ([#1444](https://github.com/h3js/h3/pull/1444))
- Add `QUERY` method docs ([#1447](https://github.com/h3js/h3/pull/1447))
- Remove non-existent sendEventStream from createEventStream example ([#1450](https://github.com/h3js/h3/pull/1450))

### 🌊 Types

- Expose `.crossws` on `defineWebSocketHandler` return type ([#1435](https://github.com/h3js/h3/pull/1435))

### 🏡 Chore

- Update deps ([8f2d46d](https://github.com/h3js/h3/commit/8f2d46d))
- Apply automated updates ([edb53fe](https://github.com/h3js/h3/commit/edb53fe))
- Update deps ([d4dceb7](https://github.com/h3js/h3/commit/d4dceb7))
- Remove extra `/* @__PURE__ */` comment ([c98f2d0](https://github.com/h3js/h3/commit/c98f2d0))
- Fix lint issue ([6962251](https://github.com/h3js/h3/commit/6962251))
- Update deps ([ece0ea2](https://github.com/h3js/h3/commit/ece0ea2))
- Bump bundle size ([b458796](https://github.com/h3js/h3/commit/b458796))
- Update deps ([78e7152](https://github.com/h3js/h3/commit/78e7152))
- **release:** V2.0.1-rc.23 ([1371ad8](https://github.com/h3js/h3/commit/1371ad8))
- Apply automated updates ([f750ea0](https://github.com/h3js/h3/commit/f750ea0))
- Update release script ([b2e12ec](https://github.com/h3js/h3/commit/b2e12ec))
- Update release script ([e965604](https://github.com/h3js/h3/commit/e965604))
- Apply automated updates ([d3a55eb](https://github.com/h3js/h3/commit/d3a55eb))
- Update deps ([e3d4bf8](https://github.com/h3js/h3/commit/e3d4bf8))

### ✅ Tests

- Cover zod schema query validation types ([#1404](https://github.com/h3js/h3/pull/1404))
- Cover cloned pipeable node responses ([#1414](https://github.com/h3js/h3/pull/1414))
- **iron-crypto:** Accept getRandomValues length error for invalid salt bits ([dae12fe](https://github.com/h3js/h3/commit/dae12fe))
- **event:** Cover shared \_url normalization semantics ([4a218a8](https://github.com/h3js/h3/commit/4a218a8))
- **event:** Assert req.url reflects normalization per runtime ([8410ec9](https://github.com/h3js/h3/commit/8410ec9))

### ❤️ Contributors

- Pi0x <x@pi0.io>
- Sueun Cho ([@sueun-dev](https://github.com/sueun-dev))
- Prateek Anand ([@bizprat](https://github.com/bizprat))
- Max ([@maxtaran2010](https://github.com/maxtaran2010))
- Pooya Parsa ([@pi0](https://github.com/pi0))
- Huseeiin ([@huseeiin](https://github.com/huseeiin))
- M.M ([@momomuchu](https://github.com/momomuchu))
- Wind ([@productdevbook](https://github.com/productdevbook))
- Iain Sproat ([@iainsproat](https://github.com/iainsproat))
- Frank Johnston <francisjohnjohnston@gmail.com>
- Mixelburg ([@mixelburg](https://github.com/mixelburg))
- Legacy ([@3m1n3nc3](https://github.com/3m1n3nc3))
- Shaurya Singh ([@LeSingh1](https://github.com/LeSingh1))
- Pupuking723 <2318857637@qq.com>
- Harsh Agarwal <harshagarwal48756@gmail.com>
- Aimee ([@Aimee1608](https://github.com/Aimee1608))
- Alan747271363-art <alan747271363@gmail.com>
- Greymoth <m.hirakawa07@icloud.com>
- Patrick Wehbe ([@patrickwehbe](https://github.com/patrickwehbe))
- Shawn <ccai40359@gmail.com>
- Alexander Kireyev ([@chatman-media](https://github.com/chatman-media))

## v2.0.1-rc.23

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.22...v2.0.1-rc.23)

### 🚀 Enhancements

- **proxy:** Support client aborts ([#1417](https://github.com/h3js/h3/pull/1417))
- **ws:** Allow optional HTTP handling in defineWebSocketHandler ([#1425](https://github.com/h3js/h3/pull/1425))
- Export `resolveDotSegments` as a public path utility ([#1428](https://github.com/h3js/h3/pull/1428))
- **readBody:** Support formdata type ([#1164](https://github.com/h3js/h3/pull/1164))

### 🩹 Fixes

- **sanitizeStatusCode:** Return default for non-numeric input instead of NaN ([#1420](https://github.com/h3js/h3/pull/1420))
- **auth:** Reject Basic credentials with no colon separator ([#1393](https://github.com/h3js/h3/pull/1393))
- **sse:** Ignore pushes after stream close ([#1411](https://github.com/h3js/h3/pull/1411))
- **proxy:** Ignore incoming accept-encoding header ([#1423](https://github.com/h3js/h3/pull/1423))
- **cache:** HandleCacheHeaders ignores multi-value If-None-Match header ([#1395](https://github.com/h3js/h3/pull/1395))
- **serve-static:** Compare if-modified-since at whole-second precision ([#1394](https://github.com/h3js/h3/pull/1394))
- **request:** Parse first entry of comma-list x-forwarded-proto header ([#1413](https://github.com/h3js/h3/pull/1413))
- **serve-static:** Check the response (not request) for an existing content-length ([#1391](https://github.com/h3js/h3/pull/1391))
- **cors:** Merge Vary headers when both origin and allow-headers emit vary ([#1396](https://github.com/h3js/h3/pull/1396))
- **writeEarlyHints:** Normalize Link key to prevent hanging with Node.js ([#1385](https://github.com/h3js/h3/pull/1385))
- **event:** Return 400 for malformed percent-encoded request URLs ([#1424](https://github.com/h3js/h3/pull/1424))
- **mount:** Restore pathname on error with try/finally ([#1319](https://github.com/h3js/h3/pull/1319))
- **serve-static:** Decode the resolved id before lookup ([#1431](https://github.com/h3js/h3/pull/1431))
- **request:** Shadow parsed \_url in requestWithURL proxy ([d21d93c](https://github.com/h3js/h3/commit/d21d93c))
- **event:** Clone URL for pathname normalization instead of mutating shared \_url ([a1cf066](https://github.com/h3js/h3/commit/a1cf066))
- **adapters:** Sync raw node req.url with event.url in fromNodeHandler ([#1433](https://github.com/h3js/h3/pull/1433))

### 💅 Refactors

- **validate:** Drop always-true `if (validate.body)` guard in body proxy ([#1392](https://github.com/h3js/h3/pull/1392))
- Leftover changes from #1428 ([#1430](https://github.com/h3js/h3/pull/1430), [#1428](https://github.com/h3js/h3/issues/1428))

### 📖 Documentation

- **proxy:** Add note about reading body ([7eb018e](https://github.com/h3js/h3/commit/7eb018e))
- Fix decode function name in router param helpers ([#1419](https://github.com/h3js/h3/pull/1419))
- **session:** Note secure cookie limitation over local HTTP ([#1409](https://github.com/h3js/h3/pull/1409))
- Document the session name option for multiple sessions ([#1405](https://github.com/h3js/h3/pull/1405))
- Add arkstack framework to community section ([#1382](https://github.com/h3js/h3/pull/1382))
- **ws:** Use zero-config crossws server plugin ([#1427](https://github.com/h3js/h3/pull/1427))

### 🌊 Types

- Expose `.crossws` on `defineWebSocketHandler` return type ([#1435](https://github.com/h3js/h3/pull/1435))

### 🏡 Chore

- Update deps ([8f2d46d](https://github.com/h3js/h3/commit/8f2d46d))
- Apply automated updates ([edb53fe](https://github.com/h3js/h3/commit/edb53fe))
- Update deps ([d4dceb7](https://github.com/h3js/h3/commit/d4dceb7))
- Remove extra `/* @__PURE__ */` comment ([c98f2d0](https://github.com/h3js/h3/commit/c98f2d0))
- Fix lint issue ([6962251](https://github.com/h3js/h3/commit/6962251))
- Update deps ([ece0ea2](https://github.com/h3js/h3/commit/ece0ea2))
- Bump bundle size ([b458796](https://github.com/h3js/h3/commit/b458796))
- Update deps ([78e7152](https://github.com/h3js/h3/commit/78e7152))

### ✅ Tests

- Cover zod schema query validation types ([#1404](https://github.com/h3js/h3/pull/1404))
- Cover cloned pipeable node responses ([#1414](https://github.com/h3js/h3/pull/1414))
- **iron-crypto:** Accept getRandomValues length error for invalid salt bits ([dae12fe](https://github.com/h3js/h3/commit/dae12fe))
- **event:** Cover shared \_url normalization semantics ([4a218a8](https://github.com/h3js/h3/commit/4a218a8))
- **event:** Assert req.url reflects normalization per runtime ([8410ec9](https://github.com/h3js/h3/commit/8410ec9))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Huseeiin ([@huseeiin](https://github.com/huseeiin))
- M.M ([@momomuchu](https://github.com/momomuchu))
- Pi0x <x@pi0.io>
- Wind ([@productdevbook](https://github.com/productdevbook))
- Iain Sproat ([@iainsproat](https://github.com/iainsproat))
- Frank Johnston <francisjohnjohnston@gmail.com>
- Mixelburg ([@mixelburg](https://github.com/mixelburg))
- Legacy ([@3m1n3nc3](https://github.com/3m1n3nc3))
- Shaurya Singh ([@LeSingh1](https://github.com/LeSingh1))
- Pupuking723 <2318857637@qq.com>
- Harsh Agarwal <harshagarwal48756@gmail.com>
- Aimee ([@Aimee1608](https://github.com/Aimee1608))
- Alan747271363-art <alan747271363@gmail.com>
- Greymoth <m.hirakawa07@icloud.com>
- Patrick Wehbe ([@patrickwehbe](https://github.com/patrickwehbe))
- Shawn <ccai40359@gmail.com>
- Alexander Kireyev ([@chatman-media](https://github.com/chatman-media))

## v2.0.1-rc.22

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.21...v2.0.1-rc.22)

### 🚀 Enhancements

- **tracing:** Export `wrapHandlerWithTracing` for manual handler wrapping ([#1369](https://github.com/h3js/h3/pull/1369))

### 🩹 Fixes

- **toEventHandler:** Validate h3 subapp instance to pick `.handler` ([a94b7fb](https://github.com/h3js/h3/commit/a94b7fb))

### 💅 Refactors

- Split plugin definition ([40bddff](https://github.com/h3js/h3/commit/40bddff))

### 📦 Build

- Simplify chunk names ([07c118d](https://github.com/h3js/h3/commit/07c118d))

### 🏡 Chore

- Update deps ([a7a0460](https://github.com/h3js/h3/commit/a7a0460))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Abdelrahman Awad <abdelrahman.awad@sentry.io>

## v2.0.1-rc.21

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.20...v2.0.1-rc.21)

### 🚀 Enhancements

- Coerce thrown number/string to HTTPError ([#1372](https://github.com/h3js/h3/pull/1372))

### 🩹 Fixes

- **setCookie:** Handle `encode` and `stringify` serialize options ([#1377](https://github.com/h3js/h3/pull/1377))
- **event-stream:** Do not emit unhandled rejection when readable side is canceled ([#1376](https://github.com/h3js/h3/pull/1376))
- **withoutBase:** Collapse leading slashes ([64acfe6](https://github.com/h3js/h3/commit/64acfe6))

### 📖 Documentation

- Fix typo in error handling ([#1364](https://github.com/h3js/h3/pull/1364))

### 🏡 Chore

- Update deps ([e2f8cbd](https://github.com/h3js/h3/commit/e2f8cbd))
- Update deps ([4e38f49](https://github.com/h3js/h3/commit/4e38f49))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Max <maximogarciamtnez@gmail.com>
- Drackin Best ([@Drackin](https://github.com/Drackin))
- Kevin Dyes <kevin.dyes@icloud.com>
- Daniel Roe ([@danielroe](https://github.com/danielroe))

