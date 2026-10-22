import {Module} from "../core/decorators.ts";
import {CLIController} from "./cli-controller.ts";
import {NewController} from "./new-controller.ts";

@Module({
    controllers: [CLIController, NewController]
})
export class CLIModule {
}