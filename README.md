# CHO

    Under development - not production ready!

[![Release](https://github.com/ziv/cho/actions/workflows/release.yml/badge.svg)](https://github.com/ziv/cho/actions/workflows/release.yml)

| Package              | Version                                                                               |
|----------------------|---------------------------------------------------------------------------------------|
| `@chojs/core`        | [![JSR](https://jsr.io/badges/@chojs/core)](https://jsr.io/@chojs/core)               |
| `@chojs/command`     | [![JSR](https://jsr.io/badges/@chojs/command)](https://jsr.io/@chojs/command)         |
| `@chojs/web`         | [![JSR](https://jsr.io/badges/@chojs/web)](https://jsr.io/@chojs/web)                 |
| `@chojs/vendor-hono` | [![JSR](https://jsr.io/badges/@chojs/vendor-hono)](https://jsr.io/@chojs/vendor-hono) |
| `@chojs/dev`         | [![JSR](https://jsr.io/badges/@chojs/dev)](https://jsr.io/@chojs/dev)                 |

CHO is a tiny decorator-based framework for building modular applications. It
utilizes modern JavaScript decorators ( see
[About JavaScript Decorators](#about-javascript-decorators)) to provide a clean
and efficient way to define application structure.

The concept is inspired by Angular, NestJS, and Spring but with a different
approach (or why this project exists):

### Standardization

Decorators and reflect metadata are not yet part of the official ECMAScript
standard, leading to inconsistencies in their implementation across different
runtimes. This lack of standardization can result in compatibility issues and
hinder the adoption of these features in production environments. This project
aims to provide a consistent and reliable way to use decorators across multiple
JavaScript runtimes, ensuring that developers can leverage these powerful
features without worrying about compatibility issues.

### Portability (Cross-Platform/Engine Agnostic)

In the modern software development landscape, the ability to deploy applications
across various environments and platforms is crucial. Developers often face
challenges when trying to ensure that their applications run seamlessly on
different runtimes such as **Node.js**, **Deno**, **Bun**, **Cloudflare
Workers**, **AWS Lambda** and more. Each of these runtimes has its own set of
features, performance characteristics, and limitations, making it difficult to
write code that is truly portable.

### Build for Performance

Minimalistic and optimized for performance!

---

## About JavaScript Decorators

This project uses the TC39 stage 3 decorators proposal (JavaScript decorators).

- [TC39 stage 3 proposal](https://github.com/tc39/proposal-decorators)
- [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)
- [decorators.deno.dev](https://decorators.deno.dev/)

<img src="./assets/cho.svg"  alt="CHO" width="200"/>

# 蝶
