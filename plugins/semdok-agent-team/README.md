# Agent Team: a Semdok Harness plugin

Adds **Orchestrator mode**: a lead agent that splits a big task across a team of specialist agents. The
specialists work **in parallel**, the lead **waits without polling**, checks what each one returns, and merges
everything into one answer.

## Install

In Semdok Harness, either:

- **Plugins → Discover**, with the Semdok Plugins market
  (`https://raw.githubusercontent.com/YumnamMomojit/Plugins/main/index.json`), then **Install** on *Agent Team*; or
- **Plugins → Add plugin**, and enter `github:YumnamMomojit/Plugins#main&path:/plugins/semdok-agent-team`.

Then click **Enable now**.

## Use

Start a **New Session**, click the mode button (it shows **Standard mode**), choose **Orchestrator mode**, and give
it a big task, for example:

- *Audit this repository: map the architecture, find the riskiest bugs, and check the test coverage.*
- *Add CSV export to the reports page, with tests, and review it before you finish.*
- *Research our three main competitors' pricing and write a one-page comparison as a Word file.*

## How it works

1. **Plan.** The Orchestrator states the goal and what "done" means, splits the work into tasks, and tracks them
   in its to-do list.
2. **Delegate in parallel.** It starts every independent task at once with the `subagent` tool, choosing a
   specialist for each (`agent_preset`) and writing a complete brief: goal, context, file paths, limits, and what to
   return. Specialists do not see the conversation, only their brief.
3. **Wait, don't poll.** When only waiting is left, it ends its turn. Each specialist's final report arrives as a
   notice that wakes the Orchestrator, which then starts any task that depended on it.
4. **Check.** It verifies each result, sends a follow-up (`send_message`) when one is wrong or incomplete, and has
   a reviewer or tester check any code a builder wrote.
5. **Merge.** You get one answer: who did what, the combined result, conflicts it resolved, and what is verified
   versus not.

While a team works, the session header shows **Orchestrator mode** and how many **subagents** it started, with a
spinner while any of them is still working.

## The team

| Specialist | Does | Can change files |
|---|---|---|
| Team Researcher | Reads code, documents and the web; reports facts with sources | No |
| Team Builder | Implements one scoped change and checks it | Yes |
| Team Reviewer | Finds bugs, gaps and security problems, with file and line | No |
| Team Tester | Runs and writes tests, reproduces bugs | Test files only |
| Team Writer | Documents, reports, slides, Word, Excel and PowerPoint files | Yes |
| Standard | Anything else (the default when no specialist is chosen) | Yes |

Researcher and Reviewer have no file-writing tools. Specialists work inside the session's permission mode (for
example **Workspace Write**), fixed when they start. They cannot ask you for approval: anything that would need it
is refused automatically and reported back, so the Orchestrator does that step itself or asks you. Specialists
cannot start their own sub-agents, so a team stays one level deep.

The specialists also appear in the mode menu, so you can use one on its own, such as **Team Reviewer** to review a
change.

## Settings

**Plugins → Subagent** (built-in plugin settings) sets how deep agents may nest, how many may run, and which model
the specialists use. A cheaper, faster model for specialists keeps a team's cost down; the Orchestrator keeps the
model you chose for the session.

A team uses more tokens than a single agent, because every specialist is its own conversation. Use Orchestrator
mode for big tasks with independent parts, and Standard mode for small ones.

## Customize

Everything is in `cordis.patch.yml`. To add a specialist, copy one of the `preset-team-…` rows, give it a new `id`,
`name`, `description` and persona, and add its `id` to `allowedAgentPresets` in the Orchestrator's `tool-subagent`
row. The `description` is what the Orchestrator reads when it picks a specialist.

## License

MIT. See [LICENSE](LICENSE).
