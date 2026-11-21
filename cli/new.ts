import { Action, Controller, Help } from "@chojs/command";

@Controller()
export class NewCommand {
  @Help(
    "Create a new project\n\n" +
      "  cho new <name>  create a new project in the folder <name>",
  )
  @Action("new")
  async new() {
    // console.log("new command");
    // const x = prompt("Project name (directory name): ");
    // project name ( -> directory name, project in standard npm/deno workspace with multiple packages)
    // package manager (npm, pnpm, bun, deno)
    // template (web, cli, message, library)
    // app/lib name ( can be derived from project name )
  }
}
