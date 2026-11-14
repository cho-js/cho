# Security Policy

## Supported Versions

Security fixes are released for the latest major version of every CHO package.

| Version | Supported |
| ------- | --------- |
| 3.x     | Yes       |
| < 3.0   | No        |

The policy covers the packages of this repository: `@chojs/core`,
`@chojs/command`, `@chojs/web`, `@chojs/vendor-cho`, `@chojs/vendor-hono` and
`@chojs/vendor-fastify`.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.**

Report them privately instead, with GitHub's private vulnerability reporting:

1. Open the [Security tab](https://github.com/cho-js/cho/security) of the
   repository.
2. Choose **Report a vulnerability**, or go straight to the
   [new advisory form](https://github.com/cho-js/cho/security/advisories/new).

The report is visible only to you and to the maintainers.

Please include as much of the following as you can. It helps us understand and
reproduce the problem quickly:

- the package and the version affected (for example `@chojs/web` 3.0.0);
- the runtime and its version (Deno, Node.js, Bun, ...);
- a description of the vulnerability and of its impact;
- the steps to reproduce it, or a small proof of concept;
- a fix or a mitigation, if you know one.

## What to Expect

- We acknowledge a report within **7 days**.
- We tell you whether we accept the report, and keep you informed while we work
  on a fix.
- When the fix is released, we publish a security advisory, and credit you in it
  unless you prefer to stay anonymous.

Please give us a reasonable time to release a fix before you disclose the
vulnerability publicly.

## Scope

A vulnerability in a dependency (Hono, Fastify, or a runtime) should be reported
to that project. Report it here when CHO uses the dependency in a way that makes
the problem worse, or when a CHO release must be updated to pick up the fix.
