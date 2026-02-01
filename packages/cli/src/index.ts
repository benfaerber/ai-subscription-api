#!/usr/bin/env bun
import * as readline from "readline"
import { SubscriptionClient } from "@opencode-ai/subscription-auth"

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

const client = new SubscriptionClient()

async function menu() {
  console.log("\n=== Subscription Auth Test ===\n")
  console.log("1. Login to ChatGPT (browser)")
  console.log("2. Login to ChatGPT (headless)")
  console.log("3. Login to Claude")
  console.log("4. Test ChatGPT")
  console.log("5. Test Claude")
  console.log("6. Show status")
  console.log("7. Exit")
  console.log()

  return prompt("Select option: ")
}

async function loginChatGPT(method: "browser" | "headless") {
  const { session, complete } = await client.login("chatgpt", method)
  console.log(`\nOpen: ${session.url}`)
  console.log(session.instructions)

  if (method === "browser") {
    Bun.spawn(["open", session.url])
    console.log("\nWaiting for browser callback...")
    await complete()
  } else {
    await complete()
  }
}

async function loginClaude() {
  const { session, complete } = await client.login("claude", "browser")
  console.log(`\nOpen: ${session.url}`)
  console.log(session.instructions)

  Bun.spawn(["open", session.url])

  const code = await prompt("\nPaste the code here: ")
  await complete(code)
}

async function testProvider(id: string) {
  const provider = client.getProvider(id)
  console.log(`\nTesting ${provider.name}...`)
  console.log(`Available models: ${provider.models.join(", ")}`)
  console.log(`Default model: ${provider.defaultModel}`)

  const message = await prompt("Enter message: ")
  const streamChoice = await prompt("Stream response? (y/n): ")
  const stream = streamChoice.toLowerCase() === "y"

  console.log(`\n${provider.name} response:`)

  if (stream) {
    const response = await client.chat(id, [{ role: "user", content: message }], {
      stream: true,
      onChunk: (chunk: string) => process.stdout.write(chunk),
    })
    console.log("\n")
    if (response.usage) {
      console.log(`Tokens: ${response.usage.input} in / ${response.usage.output} out`)
    }
  } else {
    const response = await client.chat(id, [{ role: "user", content: message }])
    console.log(response.content)
    if (response.usage) {
      console.log(`\nTokens: ${response.usage.input} in / ${response.usage.output} out`)
    }
  }
}

async function showStatus() {
  console.log("\nProvider status:")
  for (const provider of client.listProviders()) {
    const loggedIn = await provider.isLoggedIn()
    console.log(`  ${provider.name}: ${loggedIn ? "logged in" : "not logged in"}`)
  }

  console.log("\nStored credentials:")
  const creds = await client.store.all()
  if (Object.keys(creds).length === 0) {
    console.log("  (none)")
  } else {
    for (const [id, cred] of Object.entries(creds)) {
      console.log(`  ${id}:`)
      console.log(`    expires: ${new Date(cred.expires).toISOString()}`)
      console.log(`    expired: ${cred.expires < Date.now()}`)
    }
  }
}

async function main() {
  while (true) {
    try {
      const choice = await menu()

      switch (choice) {
        case "1":
          await loginChatGPT("browser")
          console.log("ChatGPT login successful!")
          break
        case "2":
          await loginChatGPT("headless")
          console.log("ChatGPT login successful!")
          break
        case "3":
          await loginClaude()
          console.log("Claude login successful!")
          break
        case "4":
          await testProvider("chatgpt")
          break
        case "5":
          await testProvider("claude")
          break
        case "6":
          await showStatus()
          break
        case "7":
          console.log("Goodbye!")
          rl.close()
          process.exit(0)
        default:
          console.log("Invalid option")
      }
    } catch (error) {
      console.error("\nError:", error instanceof Error ? error.message : error)
    }
  }
}

main()
