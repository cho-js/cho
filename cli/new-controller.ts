import {Controller} from "../core/decorators.ts";
import {Command} from "../command/decorators.ts";
import {ChoCommandContext} from "../command/context.ts";

@Controller()
export class NewController {

    @Command("new")
    create(ctx: ChoCommandContext) {
        console.log("create a new project");
        const name = prompt("Enter project name:");
        console.log(name);
    }

}