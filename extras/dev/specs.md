# @chojs/dev

The specification of `@chojs/dev`: tools for developing and debugging a CHO
application. What each tool gives, the rules it follows, and the decisions that
were made, with the alternatives.

- [1. Overview](#1-overview)
- [2. The model](#2-the-model)
- [3. The endpoints](#3-the-endpoints)
- [4. The filter](#4-the-filter)
- [5. The text formats](#5-the-text-formats)
- [6. The page](#6-the-page)
- [7. Public API](#7-public-api)
- [8. Errors](#8-errors)
- [9. Runtime support](#9-runtime-support)
- [10. Decisions](#10-decisions)
- [11. Not in this version](#11-not-in-this-version)
- [12. What this changes in the other packages](#12-what-this-changes-in-the-other-packages)

## 1. Overview

The package answers two questions about an application:

1. **What can be reached?** Every HTTP route, stream of events, WebSocket,
   message topic and command, with the method that handles it.
2. **How is it built?** Its modules, what each declares, and what imports,
   exports and injects what: as a page, and as text.

**The source is the metadata.** Every tool reads what the decorators wrote, with
`build_meta_graph` and `build_dependency_graph` of the core. Both are
synchronous, and neither creates anything: no instance, no call of a factory, no
connection. A tool is given a root module class, and needs nothing to run.

**One model, many outputs.** `inspect(target)` reads the application into a
model of plain data. The table of the endpoints, the two text formats and the
page are all made of it.

```
a root module  →  inspect()  →  ChoDevGraph  →  formatEndpoints()  the table
                                             →  toMermaid(), toDot()  text
                                             →  graphPage()  the page
                                             →  filterGraph()  a part of it
```

The package is an extra (`extras/README.md`): it reads the records of the
decorators and the two graphs of the core, which the framework does not promise
to keep. It is changed, tested and released with the framework.

## 2. The model

`ChoDevGraph` is `{ root, nodes, edges, error }`.

### 2.1 The nodes

| Kind         | Made of                                             |
| ------------ | --------------------------------------------------- |
| `module`     | Each module reachable from the root, once           |
| `provider`   | Each entry of the `providers` of a module           |
| `controller` | Each entry of the `controllers` of a module         |
| `endpoint`   | Each method of a controller that is an endpoint (3) |
| `missing`    | A token a module asks for and nothing gives (2.4)   |

Every node has:

- `id`: what identifies it in the model;
- `name`: of the class or the token, as `describe` of the core gives it
  (`"UsersService"`, `"InjectionToken(CONFIG)"`, `"Symbol(clock)"`); of an
  endpoint, what is reached (`"GET /users"`, `"orders.paid"`, `"build"`);
- `module`: the id of the module that declares it. Of a module, its own id.

A module also has `root`, and a module and a controller have `middlewares` (the
names of the middlewares of `@Middlewares`, in order) and `errorHandler` (the
name of the handler of `@Catch`, or `null`). A provider has `token`: `"class"`,
`"token"` (an injection token) or `"symbol"`.

**One node for each declaration**, as the injector counts them: a class two
modules declare is two nodes, because it is two instances. A module imported
through several paths is one node.

**The order.** The modules come root first, each before what it imports, each
once. A module is followed by its providers, then its controllers, each
controller by its endpoints, then by what it is missing. The mounted routes of
an application come last.

**The ids** are readable, and the same from one run to the next:

| Node                     | Id                                 |
| ------------------------ | ---------------------------------- |
| A module                 | `UsersModule`                      |
| A provider, a controller | `UsersModule/UsersService`         |
| An endpoint              | `UsersModule/UsersController.list` |
| What is missing          | `UsersModule/?Mailer`              |
| A mounted route          | `AppModule/GET /health`            |

An id that is taken gets a number: the second module named `Feature` is
`Feature#2`.

### 2.2 The edges

| Kind      | From          | To                                           |
| --------- | ------------- | -------------------------------------------- |
| `imports` | A module      | Each module of its `imports`                 |
| `exports` | A module      | What each token of its `exports` resolves to |
| `injects` | A declaration | What each of its dependencies resolves to    |

A declaration is a provider, a controller or a module: a module can have
dependencies, and can be one. The edges of one node are in the order of the
declaration. An edge that would be there twice is there once.

What declares what is not an edge: it is the `module` of a node, and the
`controller` of an endpoint.

### 2.3 How a token is resolved

By the core. `inspect` builds the dependency graph, and reads where each module
finds each token in the `visible` table of its scope (`core/specs.md`, section
2.4). So an edge follows the scope rules: a module sees what it declares, then
what its direct imports export; its own declarations win; a token a module
exports again leads to where it is declared.

### 2.4 A broken application

When the dependency graph cannot be built, the application is read all the same:

- `error` holds the `code` and the `message` of the error the core threw, the
  one `new Injector(root)` would throw;
- each token is looked for where it most likely is: among the declarations of
  the module, then among what its imports export, following a token that is
  exported again. A token two imports export as two declarations is not chosen
  between;
- what is not found is a `missing` node, of the module that asks for it. A
  module that asks for one token twice has one node for it.

The core stops at the first mistake, and the model shows every dependency that
is not found: there can be more `missing` nodes than the one the error names.

When the metadata graph itself cannot be built (a class without its decorator, a
class in the wrong list, circular imports), there is no application to read: the
error of the core is thrown as it is.

### 2.5 What is not in the model

Names, routes and topics are; nothing else is. No value of a provider, no
instance, no function, no option of a module or of a controller other than its
route and its topic, no argument of a handler, no schema. `JSON.stringify`
writes the model whole, and `JSON.parse` gives an equal one.

## 3. The endpoints

An endpoint is a method of a controller that a decorator of an application
package marked. `ChoDevEndpoint` is a node of the model, with:

| Field          | What it is                                                               |
| -------------- | ------------------------------------------------------------------------ |
| `type`         | `"http"`, `"sse"`, `"ws"`, `"message"` or `"command"`                    |
| `controller`   | The id of its controller; `null` for a mounted route                     |
| `handler`      | The name of the method; for a mounted route, the name of the route       |
| `method`       | The HTTP method, for `http`, `sse` and `ws`                              |
| `path`         | The whole path, for `http`, `sse` and `ws`                               |
| `topic`        | The whole topic, for `message`                                           |
| `command`      | The name of the command, for `command`; `"main"` for `@Main`             |
| `events`       | The events the controller handles, in order, for `ws`                    |
| `middlewares`  | The names of the middlewares of its module, its controller and its own   |
| `errorHandler` | The name of the nearest handler: its own, its controller's, its module's |
| `mounted`      | Whether it is a route that was mounted on the application                |

### 3.1 How the records are read

The records of the three packages are found by their keys, which are global
symbols:

| Package          | Key                       | Written by                          |
| ---------------- | ------------------------- | ----------------------------------- |
| `@chojs/web`     | `chojs.web.http`          | `@Get`, `@Post`, ..., `@Sse`, `@Ws` |
| `@chojs/web`     | `chojs.web.ws`            | `@WsOpen`, `@WsMessage`, `@WsClose` |
| `@chojs/message` | `chojs.message.subscribe` | `@Subscribe`                        |
| `@chojs/command` | `chojs.command.isMain`    | `@Main`                             |
| `@chojs/command` | `chojs.command.isAction`  | `@Action`                           |
| `@chojs/command` | `chojs.command.alias`     | `@Main`, `@Action`                  |

A method can have more than one: it is then more than one endpoint.

### 3.2 The path and the topic

They are joined as the packages join them:

- **A path** is `/`, then the routes of the application (its global prefix), of
  the module, of the controller and of the method, joined with `/`. A level that
  has no route adds nothing.
- **A topic** is the same four levels, joined with `.`.
- **The topic of a contract** is whole: the topics of the module and of the
  controller are the start of it already, and only the prefix of the application
  is added.

The global prefix is an option of an application, not a declaration: a module or
an injector as the target has none, and an application as the target adds its
own. The prefix of a web application is added to the paths, and the prefix of a
message application to the topics.

### 3.3 The mounted routes

A route that was added with `app.mount` is declared by no controller. With a web
application as the target, each of its routes that no endpoint has is an
endpoint of its own: `mounted` is `true`, `controller` is `null`, `handler` is
the name the route was given, and it is shown in the root module. Its
middlewares are not known: they are functions the application holds.

### 3.4 The table

`formatEndpoints` writes a part for each kind of application that has endpoints,
in this order: `HTTP` (`http`, `sse` and `ws`), `MESSAGE`, `COMMAND`.

- A line has what is reached, `Controller.method`, the module, and the
  middlewares, joined with `,`.
- What is reached is the method and the path; `SSE` and `WS` are written in
  place of the method. Or the topic, or the command.
- The columns of a part are aligned, two spaces apart, with no space at the end
  of a line.
- A mounted route has its name in place of `Controller.method`, and `(mounted)`
  in place of the module.
- Nothing to show is `No endpoints.`.

The `types` option keeps the types that are named. `printEndpoints` writes the
same text with `console.log`.

## 4. The filter

`filterGraph(target, filter)` returns a new model, with a part of the nodes.

| Rule     | A node passes when                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `kinds`  | Its kind is named; or it is an endpoint, and its type is                                                          |
| `search` | The text is in its name or in the name of its module; of an endpoint, also in its path, topic, command or handler |
| `around` | It is the node, or within `depth` steps of it                                                                     |

- A node must pass every rule that is given. No rule: every node passes.
- `kinds` names kinds of nodes (`"module"`, `"provider"`, `"controller"`,
  `"endpoint"`, `"missing"`) and types of endpoints (`"http"`, `"sse"`, `"ws"`,
  `"message"`, `"command"`). `"endpoint"` is every type.
- `search` is trimmed, and has no regard to case. The name of a module finds
  everything the module declares.
- A step of `around` follows an edge, in either direction, or goes between a
  controller and one of its endpoints. It does not go between a module and what
  it declares: that would reach the whole module in one step. `depth` is a whole
  number, `0` or more; the default is `1`.
- **A node that is kept keeps its module, and an endpoint its controller**,
  whatever the rules say of them: a node is never shown outside its box.
- An edge is kept when both its ends are.
- `root` and `error` are kept as they are. The model that is given does not
  change.

## 5. The text formats

Both are made of the same arrangement of the model:

- a module holds what it declares;
- an `imports` and an `injects` edge is a line; an `exports` edge is not: what a
  module exports is marked;
- a controller has a line to each of its endpoints;
- a line between a node and the module that holds it is left out: a drawing
  cannot join a box to what is inside it. It is the case of a provider that
  injects its own module, and of a module that injects one of its providers.

| What                | Mermaid (`toMermaid`)            | DOT (`toDot`)                   |
| ------------------- | -------------------------------- | ------------------------------- |
| A module            | A `subgraph`                     | A `cluster`                     |
| A module of nothing | A node, `[[name]]`               | A `cluster`, empty              |
| A provider          | `[name]`                         | `shape=box`                     |
| A controller        | `([name])`                       | `shape=box, style="rounded"`    |
| An endpoint         | `[/name/]`                       | `shape=cds`                     |
| What is missing     | `{{name}}`, with a dashed border | `shape=hexagon, style="dashed"` |
| An import           | `==>`                            | A bold arrow, from box to box   |
| A dependency        | `-->`                            | An arrow                        |
| An endpoint's line  | `---`                            | A dotted line, with no arrow    |
| What is exported    | A thick border                   | `peripheries=2`                 |

A node is named `n0`, `n1`, ..., by its place in the model. A name of the
application is always inside quotes: in Mermaid, `#`, `&`, `"`, `<`, `>` and a
backtick are written as entity codes, and a line break as a space; in DOT, `\`
and `"` are escaped, and a line break is `\n`.

In DOT, a line to a module needs a node to end at, which a cluster is not: each
cluster has an invisible point, and the line is cut at the border of the cluster
(`compound=true`, `ltail`, `lhead`).

Both take a filter as a second argument, and apply `filterGraph`.

## 6. The page

`graphPage(target, options)` returns one HTML file.

- The model is inside it, as JSON, in a `script` element of type
  `application/json`. Every `<` of it is written as an escape, so no name can
  close the element.
- The title is the `title` option, or the name of the root module.
- The drawing is made by Cytoscape.js, with the layered layout of ELK, through
  `cytoscape-elk`. The three files are loaded from jsDelivr, at the exact
  versions of `PAGE_VERSIONS`. With `assets`, they are loaded from there, by
  their names: `cytoscape.min.js`, `elk.bundled.js`, `cytoscape-elk.js`.
- When the libraries cannot be loaded, the page says so: the search and the
  details still work.

### 6.1 What it draws

A module is a box that holds what it declares. An endpoint is next to its
controller, joined to it by a dotted line. The lines are those of section 5; the
modules are placed in layers, from the root to what it imports.

### 6.2 What it does

| Control                                  | Does                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Providers, Controllers, Endpoints        | Hides the nodes of that kind: the `kinds` rule                                      |
| HTTP, SSE, WebSocket, Messages, Commands | Hides the endpoints of that type. There when the application has more than one type |
| Dependencies                             | Hides the `injects` lines                                                           |
| The search                               | Lights what matches, and dims the rest; the side lists what matches                 |
| Hide what does not match                 | Hides the rest instead: the `search` rule                                           |
| A node                                   | Selects it: the side shows its details, and what is next to it is lit               |
| Only this and what is near               | Draws the node with what is 1 to 4 steps away: the `around` rule                    |
| Fit, Reset                               | Fits the drawing to the window; goes back to the first view                         |
| `/`, `Escape`                            | Goes to the search; leaves it, or unselects                                         |

The details of a node are its kind, its module, the fields of section 2 and 3,
and what it is related to, each a button that selects that node: what it
injects, what injects it, what exports it; of a module, what it imports, what
imports it, what it exports and declares; of a controller, its endpoints. They
are read from the whole model, not from the part that is drawn. Selecting a node
the filter hides draws it with what is near it.

The switches, the search and the selection are kept in the hash of the address:
a view can be sent, and it is there after a reload.

The error of a broken application is shown at the top, and what is missing is
red, with a dashed border.

### 6.3 The rules, written twice

The page filters in the browser, so the rules of section 4 are in its script
too: `PAGE_RULES`, plain JavaScript that does not use the document. A test
evaluates that text, gives the two the same models and the same filters, and
compares what they keep. One rule differs, on purpose: `around` a node the model
has not is an error of `filterGraph`, and no filter for the page, which reads it
from an address anyone can write.

### 6.4 The names of the application

No name is written as HTML. In the page that is returned, a name is only inside
the JSON of the model (and the title, which is escaped). In the browser, the
script writes names with `textContent`, and Cytoscape.js draws them on a canvas.

### 6.5 On a web application

`devRoutes(app, options)` mounts two routes, with `app.mount`:

| Route                    | Answers                              |
| ------------------------ | ------------------------------------ |
| `GET <route>`            | The page, `text/html; charset=utf-8` |
| `GET <route>/graph.json` | The model, `application/json`        |

- `route` is `"__cho"` by default. It is written like the route of a decorator,
  and it is not under the global prefix.
- The model is read once, when `devRoutes` is called, before its two routes are
  added: they are not in it. The routes that were mounted before are.
- No middleware of the application runs for the two routes: they have the
  `middlewares` of the options.
- The options are checked before anything is mounted. The route is checked by
  `app.mount`, and has its errors.
- It is for development: the page shows the structure of the application to
  whoever can reach the route.

The application is typed by what is used of it (`ChoDevWebApplication`): its
injector, and `mount`. The package does not import `@chojs/web`.

## 7. Public API

| Export                                                                                  | What it is                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `inspect(target)`                                                                       | The model of an application                |
| `endpoints(target)`                                                                     | Its endpoints                              |
| `formatEndpoints(target, options?)`                                                     | The table of its endpoints, as a string    |
| `printEndpoints(target, options?)`                                                      | The same, written with `console.log`       |
| `filterGraph(target, filter?)`                                                          | A part of the model                        |
| `toMermaid(target, filter?)`, `toDot(target, filter?)`                                  | The model as the text of a drawing         |
| `graphPage(target, options?)`                                                           | The page, as HTML                          |
| `devRoutes(app, options?)`                                                              | Mounts the page on a web application       |
| `PAGE_VERSIONS`                                                                         | The version of each library the page loads |
| `ChoDevGraph`, `ChoDevNode`, `ChoDevEdge`                                               | The model                                  |
| `ChoDevModule`, `ChoDevProvider`, `ChoDevController`, `ChoDevEndpoint`, `ChoDevMissing` | The kinds of nodes                         |
| `ChoDevNodeKind`, `ChoDevEndpointType`, `ChoDevSocketEvent`                             | Their names                                |
| `ChoDevFilter`                                                                          | The rules of a filter                      |
| `ChoDevTarget`, `ChoDevInjector`, `ChoDevApplication`, `ChoDevWebApplication`           | What the tools take                        |
| `FormatEndpointsOptions`, `GraphPageOptions`, `DevRoutesOptions`                        | The options                                |
| `ChoDevErrorCode`                                                                       | The codes of the errors                    |

**The target** of every function is a root module class, an injector, an
application that has an injector, or a model. They are told apart by what they
have, not by their class: an injector has the two graphs, an application has an
injector, a model has `root`, `nodes` and `edges`. A model is used as it is.

## 8. Errors

A mistake is a `ChoError` of the core: an `Error` with a stable `code`. The
codes of this package start with `CHO_DEV_` (type `ChoDevErrorCode`); a mistake
the core or `@chojs/web` finds has its own code. `<fn>` is the function that was
called.

| Mistake                                  | Code                     | Message                                                                                |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| A target that is none of the four        | `CHO_DEV_INVALID_TARGET` | `<fn>: expected a root module class, an injector or an application, got <value>`       |
| No options                               | `CHO_DEV_INVALID_OPTION` | `<fn>: expected options, such as { title: "My application" }, got <value>`             |
| `title` or `assets` that is not a string | `CHO_DEV_INVALID_OPTION` | `<fn>: "<option>" must be a string, got <value>`                                       |
| `types` that is not an array             | `CHO_DEV_INVALID_OPTION` | `<fn>: "types" must be an array, got <value>`                                          |
| A type that does not exist               | `CHO_DEV_INVALID_OPTION` | `<fn>: unknown type <value>. Known types: http, sse, ws, message, command`             |
| No filter                                | `CHO_DEV_INVALID_OPTION` | `<fn>: expected a filter, such as { kinds: ["module"] }, got <value>`                  |
| `kinds` that is not an array             | `CHO_DEV_INVALID_OPTION` | `<fn>: "kinds" must be an array, got <value>`                                          |
| A kind that does not exist               | `CHO_DEV_INVALID_OPTION` | `<fn>: unknown kind <value>. Known kinds: module, provider, controller, endpoint, ...` |
| `search` that is not a string            | `CHO_DEV_INVALID_OPTION` | `<fn>: "search" must be a string, got <value>`                                         |
| `around` that is not a string            | `CHO_DEV_INVALID_OPTION` | `<fn>: "around" must be the id of a node, got <value>`                                 |
| `depth` that is not a whole number       | `CHO_DEV_INVALID_OPTION` | `<fn>: "depth" must be a whole number, 0 or more, got <value>`                         |
| `around` a node the model has not        | `CHO_DEV_UNKNOWN_NODE`   | `filterGraph(): the graph has no node <id>`                                            |

Found by the others:

| Mistake                                   | Code                                        |
| ----------------------------------------- | ------------------------------------------- |
| An option, or a rule, that does not exist | `CHO_CORE_UNKNOWN_OPTION`                   |
| A class that is not a module              | `CHO_CORE_NOT_A_MODULE`                     |
| Any other invalid metadata                | The code of the core (`core/specs.md`, 2.8) |
| A route of `devRoutes` that is not valid  | `CHO_WEB_INVALID_ROUTE`                     |
| A route of `devRoutes` that is taken      | The code of `app.mount` (`web/specs.md`)    |

An application whose dependencies cannot be linked throws nothing: its error is
in the model (2.4).

## 9. Runtime support

Deno, Node.js, Bun, Cloudflare Workers and other edge runtimes. Everything but
`devRoutes` is a function of data to data, and uses the language alone;
`devRoutes` runs where `@chojs/web` does, with every adapter. The package
depends on `@chojs/core` alone.

The page needs a browser that can reach the CDN, or the `assets` option.

The names in the model are the names of the classes and of the functions. A
bundle that is minified without keeping the names gives a model of short names.

## 10. Decisions

1. **The source is the metadata, not a running application.** A graph of an
   application is wanted when it does not start, and by a tool that has no
   database to give it. So nothing is created, and a root module is enough.
   _Alternative: read `app.graph` of a created application. It has the instances
   and the functions, which a drawing does not need, and it needs the
   application to start._
2. **The core resolves the dependencies.** The scope rules are in one place:
   `build_dependency_graph`. The tools read its result. _Alternative: resolve
   here. The rules would be written twice, and a drawing could show an edge the
   injector does not follow._
3. **A broken application is drawn.** The simple lookup of 2.4 is used only
   then, and the model says so with its `error`. _Alternative: throw. The tool
   would be of no use for the one mistake it is most wanted for._
4. **One model of plain data.** It can be put in a page, sent, kept in a file,
   and compared in a test. Every output is a function of it, so a new one needs
   nothing from the framework.
5. **The records of the application packages are read by their keys.** The keys
   are global symbols, so no package is imported, and `@chojs/dev` depends on
   the core alone. The shape of three records, and the join of a path and of a
   topic, are written here a second time; the tests use the real decorators and
   compare with the routes of created applications. _Alternative: import the
   readers of the three packages. An application of one kind would install all
   three._
6. **The page draws with Cytoscape.js and ELK, from a CDN.** A graph with boxes
   inside boxes, and lines that leave them, needs a real layout: ELK has one,
   and Cytoscape.js draws, zooms and selects. They are the page's, not the
   package's: nothing is installed, and the versions are exact. _Alternative: a
   layout written here, in SVG. It would work with no network, and be worse for
   a large application._
7. **ELK through `cytoscape-elk`, at the version of `elkjs` it asks for.**
   `elkjs` has newer versions; the adapter was made for this one.
8. **The filter is written twice**, here and in the script of the page, and a
   test compares the two. _Alternative: put the function in the page with
   `toString`. What a transpiler adds to a function (helpers that keep names)
   breaks it in a browser._
9. **Mermaid and DOT are text.** GitHub draws the first in a Markdown file,
   Graphviz draws the second. Nothing is installed for either.
10. **A node that is kept keeps its module.** A node outside its box says less,
    and the text formats and the page have nowhere to put it.
11. **No command line tool.** The package exports functions; a command of a CLI
    can call them.
12. **`devRoutes` is typed by what it uses.** A `ChoWeb` is accepted without
    importing `@chojs/web`, and the type of a middleware is inferred from the
    application.
13. **The dev routes are under `__cho`**, a name no application route is likely
    to have, and not under the global prefix: the prefix is for the routes the
    application declares.

## 11. Not in this version

- **What looks wrong**: a class two modules declare, a provider nothing injects,
  an export no importer uses.
- **`explain(target, token, module)`**: who gives a token to a module, and
  through which exports.
- **What happens at run time**: the order in which the injector creates the
  instances, and how long each took.
- **The messages an application sends** (`ChoMessageClient`), as edges to the
  topics.
- **The command of a `ChoCommand` as a target**: it keeps its injector private.
- **A drawing with no network**, other than with `assets`.

## 12. What this changes in the other packages

- `@chojs/core/di` exports `build_meta_graph` and `build_dependency_graph`.
  Their types were exported already.

Nothing else: no decorator, no option and no record of a package changes.
