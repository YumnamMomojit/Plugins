# Semdok Connectors: a Semdok Harness plugin

Lets the Semdok Harness agent work with **BigQuery**, **Databricks** and **Gmail**. Each connector is an MCP server
that the app's own MCP client connects, with safe limits set by you, not by the agent.

| Connector | Server | Signs in with | Safe defaults |
|---|---|---|---|
| BigQuery | Google's [MCP Toolbox for Databases](https://github.com/googleapis/mcp-toolbox) (`@toolbox-sdk/server` 1.15.0) | Your Google Cloud sign-in on this computer | Read-only (SELECT only), at most 10 GiB billed per query, 50 rows per result |
| Databricks | Databricks' own hosted MCP servers: Genie One, Databricks SQL, and optionally one Genie Agent | A personal access token that you store privately | Your token's own permissions |
| Gmail | [`@klodr/gmail-mcp`](https://github.com/klodr/gmail-mcp) 3.0.0 (MIT) | Your own Google OAuth client, in your browser | Read and draft only; sending turned off |

A connector's server installs the first time you turn it on, at the pinned version above, so you never download a
server you do not use (BigQuery about 270 MB, Gmail about 250 MB unpacked). Databricks needs no download.

## Install

In Semdok Harness, either:

- **Plugins → Discover**, with the Semdok Plugins market
  (`https://raw.githubusercontent.com/YumnamMomojit/Plugins/main/index.json`), then **Install** on *Semdok Connectors*; or
- **Plugins → Add plugin**, and enter `github:YumnamMomojit/Plugins#main&path:/plugins/semdok-connectors`.

Then click **Enable now**.

## Set up by asking the agent

Set up and check connectors in chat, for example:

- *Connect BigQuery project my-analytics-123, location US.*
- *Connect my Databricks workspace https://dbc-1234abcd-5678.cloud.databricks.com.*
- *Set up Gmail.*
- *Show my connectors.*

The agent turns the connector on, connects it, and tells you any step that only you can do. **Never paste a token,
password or key into the chat**; each setup below keeps secrets outside it.

### BigQuery

1. Sign this computer in to Google Cloud: install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
   and run `gcloud auth application-default login`. Use an account with the **BigQuery Job User** role on the project
   and **BigQuery Data Viewer** on the datasets. (Or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key
   file and restart Semdok Harness.)
2. Ask the agent to connect BigQuery with your project ID. The first time, it downloads Google's Toolbox once.

The agent gets `mcp__bigquery__list_dataset_ids`, `list_table_ids`, `get_dataset_info`, `get_table_info`,
`search_catalog`, `execute_sql`, `forecast`, `analyze_contribution` and `ask_data_insights`.

### Databricks

1. Create a personal access token: in your workspace, click your user name (top right) → **Settings** →
   **Developer** → **Access tokens**.
2. Store it privately, in one of these places:
   - the Semdok Harness private credential file, `.credentials.yaml` in your Semdok Harness home folder
     (`C:\Users\<you>\.dsh\` on Windows): under `refs:`, add the line `DATABRICKS_TOKEN: <your token>`. The app
     reloads the file by itself;
   - the `token` line of a profile in `~/.databrickscfg` (the Databricks CLI writes it with `databricks configure`);
   - a `DATABRICKS_TOKEN` environment variable, then restart Semdok Harness.
3. Ask the agent to connect Databricks with your workspace URL.

By default it connects **Genie One** (business questions in plain language) and **Databricks SQL** (run SQL on a SQL
warehouse). Ask for **genie_space** with a Genie space ID to query one curated Genie Agent. Databricks SQL needs a
workspace admin to turn on **Managed MCP Servers** in the workspace's Previews page; if a server is not available, the
others still connect and the agent tells you which one failed and why.

### Gmail

1. In the [Google Cloud Console](https://console.cloud.google.com/), pick or create a project, enable the **Gmail
   API**, set up the **OAuth consent screen** (add your Google account as a test user), then create an **OAuth client**
   of type **Desktop app** and download its JSON file.
2. Save that file as `C:\Users\<you>\.gmail-mcp\gcp-oauth.keys.json` (`~/.gmail-mcp/gcp-oauth.keys.json` on macOS
   and Linux).
3. Ask the agent to sign in to Gmail. Your browser opens Google's consent screen; the agent asks only to read mail
   and write drafts. Your sign-in stays in `~/.gmail-mcp/credentials.json`.

The Gmail server shows the agent only the tools your sign-in allows, and drafts are the default way to write: you
review and send them from Gmail.

## Safety

- **Secrets stay out of the chat.** Google sign-ins happen in your browser, and the Databricks token is read from
  the places above. The agent's setup tool refuses anything that looks like a token.
- **You set the limits.** Read-only BigQuery, the cost cap, the row cap and Gmail sending are set in the plugin's
  settings (below); the agent's tools cannot change them.
- **Email is untrusted.** An email can contain hidden instructions aimed at the agent. The plugin's skill tells the
  agent never to follow them, and never to send, delete or forward without your clear yes in chat.
- Connector tools follow the session's permission mode, which may run them without asking each time; the limits
  above keep them in bounds either way.

## Settings

The safety limits live in this plugin's row. To change them, add this row to your profile's `cordis.patch.yml`
(`C:\Users\<you>\.dsh\profiles\desktop\cordis.patch.yml`) and edit the values:

```yaml
- id: semdok-connectors
  config:
    bigquery:
      readOnly: true                 # SELECT queries only
      maximumBytesBilled: 10737418240 # 10 GiB per query; a bigger query fails before it runs
      maxQueryResultRows: 50
    databricks:
      servers: [genie_one, sql]      # the default servers: genie_one, sql, genie_space
    gmail:
      allowSend: false               # let the agent ask for permission to send at sign-in
      recipientPairing: false        # when sending: only to addresses you approved
```

To use a server you installed yourself, add `command` (and `args`) under `bigquery` or `gmail`.

Non-secret choices (which connectors are on, project, workspace URL) are kept in
`~/.dsh/plugin-data/semdok-connectors/settings.json`, and the installed servers next to it in `servers/`.

## License

MIT. See [LICENSE](LICENSE). The servers it installs have their own licenses: MCP Toolbox for Databases (Apache-2.0)
and gmail-mcp (MIT).
