import {Controller} from "@chojs/core";
import {type ChoCommandContext, Command, Help} from "@chojs/command";

@Controller()
export class CLIController {

    @Command("help")
    help() {
        console.log("This is the help command. Use --help with other commands for more information.");
    }

    @Help("Generate a new project scaffold")
    @Command("new")
    newProject(ctx: ChoCommandContext) {

    }

    @Command("generate")
    generate(ctx: ChoCommandContext) {

    }
}