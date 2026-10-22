# Low Level Architecture

## Data Types

Instead of using types and plain objects, we choose to use classes. This is reduces the shapes created under the hood in
the V8 engine, leading to better performance (TBD check for other engines).

## API Design

#### Prefer Functions

For any API endpoint that not require carry on dependencies or not require extensibility, we use functions.

#### Classes usage

Only when one of the following conditions is met, we use classes:

1. The entity has a lifecycle (e.g., needs to be initialized, disposed, etc.)
2. The entity has dependencies that need to be carried around between method calls.
3. The entity is expected to be extended in the future (e.g., via inheritance or composition).

Asynchronous initialization is done via static factory methods.