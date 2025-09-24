# @chojs/core

Core modules for `CHO` framework.

The CHO core module provides the fundamental building blocks for the CHO framework,
including dependency injection, metadata handling, and application lifecycle management.

## Dependency Injection

Create injectable services and organize them into modules:

```ts

@Injectable({deps: [DatabaseService]})
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
            }
        }
    ]
})
class UserModule {
}
```

TBC...