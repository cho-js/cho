# @chojs/core

Core modules for the **_CHO_** framework.

The CHO core module provides the fundamental building blocks for the **CHO**
framework, including dependency injection, metadata handling, and application
lifecycle management.

## Submodules

| Submodule                 | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `@chojs/core/meta`        | [Metadata utilities](#metadata-utilities)       |
| `@chojs/core/di`          | [Dependency Injection](#dependency-injection)   |
| `@chojs/core/application` | [Application lifecycle](#application-lifecycle) |
| `@chojs/core/testing`     | [Tests runner](#testing)                        |
| `@chojs/core/utils`       | [Core utilities](#utilities)                    |

## Examples

### Metadata Utilities

```ts
import { addToMetadataObject, readMetadataObject } from "@chojs/core/meta";
```

Read and write metadata to and from classes and methods. Used by decorators to
store metadata in a structured way.

```ts
class Example {
}

addToMetadataObject(Example, { key0: "value0" });
addToMetadataObject(Example, { key1: "value1" });

readMetadataObject(Example); // { key0: 'value0', key1: 'value1' }
```

Arrays with the same key are merged automatically:

```ts
class Example {
}

addToMetadataObject(Example, { key: ["value0"] });
addToMetadataObject(Example, { key: ["value1"] });

readMetadataObject(Example); // { key: ['value0', 'value1'] }
```

---

### Dependency Injection

Create injectable services and organize them into modules:

```ts
@Injectable({ deps: [DatabaseService] })
class UserService {
  constructor(private db: DatabaseService) {
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: UserService,
      factory: (injector) => {
        const db = injector.resolve(DatabaseService);
        return new UserService(db);
      },
    },
  ],
})
class UserModule {
}
```

Resolving dependencies:

```ts
// creating (or getting) injector for specific module
const injector = await Injector.get(UserModule);

// resolving a dependency
const service = await injector.resolve(UserService);
```

### Application Lifecycle

Compiling application:

```ts
@Module()
class Example {
}

const graph = graphBuilder(Example);
const compiled = await new Compiler().compile(graph);
```

Applying lifecycle hooks:

```ts
onModuleInit(compiled);
```

### Testing

Using single test runner for all environments:

```ts
import { test } from "@chojs/core/testing";

test("example test", () => {
  // test code
});
```

### Utilities

Private API utilities
