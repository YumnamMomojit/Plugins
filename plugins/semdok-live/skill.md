# Add the Sem live assistant to a website

Sem is Semdok's 3D conversational assistant. One script tag from `https://live.semdok.com` adds a launcher button
to every page; clicking it opens the assistant in a window. The assistant's personality, knowledge, and voice are
set in **Semdok Console → Assistants**; the tag only chooses which assistant appears and how it looks.

## 1. Get the public key

- Ask the user for their assistant's **public key**: `sem_pub_live_` followed by 16 hex characters, shown with the
  embed code in Semdok Console → Assistants. `sem_pub_demo` works for a quick test.
- **Never** use a secret key (`sk-…` or `sk_…`): the widget hands its key to the visitor's browser. If the user
  offers a secret key, refuse, explain why, and suggest rotating it in the Console if it was shared anywhere.

## 2. Find the site type

Look at the workspace before asking:

| Evidence | framework |
|---|---|
| `next` in package.json and an `app/` directory | `nextjs-app` |
| `next` in package.json and a `pages/` directory | `nextjs-pages` |
| `vite` or `react-scripts` in package.json, with `index.html` | `react-vite` |
| Plain `.html` files | `html` |
| No code here: WordPress, Shopify, Wix, or Webflow site | that platform (give the user the steps) |

## 3. Check for an existing widget

Search the project for `live.semdok.com/widget`. If a tag is already there, **update that tag** instead of adding a
second one; two tags show two launchers.

## 4. Build and place the tag

- Call `semdok_live_embed_code` with the key, the framework, and what the user asked for (brand name, greeting,
  avatar, theme, position, button text, auto-open). Do not invent settings the user did not ask for.
- Insert the returned snippet exactly where `placement` says, with your normal file-editing tools, so the user sees
  and approves the change. For a static site with several pages, add it to every page or to the shared template.
- For WordPress, Shopify, Wix, or Webflow, give the user the snippet and the placement steps.

## 5. Check it

- If the project has a dev server, start it, open the page, and confirm a launcher button appears in the chosen
  corner; opening it should load the assistant from live.semdok.com.
- Tell the user the change only reaches visitors after they deploy or publish.

## 6. Remind the user

- In Semdok Console → Assistants, restrict the assistant to their own domains.
- Usage of the assistant counts against their Semdok plan.

## Controlling Sem from the page

After the script loads, the page can use `window.SemAssistant`:

```js
SemAssistant.open()                     // open the assistant
SemAssistant.close()
SemAssistant.toggle()
SemAssistant.sendMessage('Show me pricing')  // open and ask something
SemAssistant.on('ready', () => { /* assistant loaded */ })
```

For example, a "Talk to us" button: `<button onclick="SemAssistant.open()">Talk to us</button>`.

## Remove Sem

Delete the script tag (search for `live.semdok.com/widget`) and any `SemAssistant` calls, then redeploy.
