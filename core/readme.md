# @chojs/core

Core modules for the **_CHO_** framework.

The CHO core module provides the fundamental building blocks for the **CHO**
framework, including dependency injection, metadata handling, and application
lifecycle management.

## Public API

Dependency injection and application lifecycle management decorators (`@Injectable`, `@Module`, `@Controller`, etc.)

### Examples

#### Dependency Injection

Explicit and implicit injection of services using decorator or module metadata. Import `ExampleModule` to get access its
providers.

```ts
import {Injectable, Module} from "@chojs/core";

class DatabaseService {
    constructor(url: string) {
    }
}

@Injectable({deps: [DatabaseService]})
class ExampleService {
    constructor(private db: DatabaseService) {
    }
}

@Module({
    imports: [OtherModule],
    providers: [
        {
            provide: DatabaseService,
            factory: async (injector) => {
                const dep = await injector.resolve('DB_URL');
                return new DatabaseService(dep);
            },
        },
        ExampleService,
    ],
})
class ExampleModule {
}

```


## Submodules

| Submodule               | Description                                                  |
|-------------------------|--------------------------------------------------------------|
| `@chojs/core/internals` | DI and application lifecycle. Consumed by other CHO modules. |
| `@chojs/core/testing`   | [Tests runner](#testing)                                     |
| `@chojs/core/utils`     | [Core utilities](#utilities)                                 |
