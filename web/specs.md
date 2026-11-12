# @chojs/web Specifications

some rules.

1. modules with controllers are features.
2. only feature modules, controllers can and methods have routes.
3. there are only 4 level of routes: global prefix, feature, controller, action
   (nestjs allow only 3 levels of routes, but chojs allow 4 levels of routes).
   global prefix is added from the application options.
4. all features are attached to the root route.
5. middlewares and error handlers on none feature modules are ignored.
