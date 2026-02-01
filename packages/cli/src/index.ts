#!/usr/bin/env bun
import * as readline from "readline"
import { SubscriptionClient } from "../../../src/index"

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
const providers = client.listProviders()

function openUrl(url: string) {
  Bun.spawn(["open", url])
}

async function login(providerId: string) {
  const provider = client.getProvider(providerId)
  const method = providerId === "chatgpt" ? await prompt("Method (browser/headless): ") as "browser" | "headless" : "browser"
  
  const { session, complete } = await client.login(providerId, method)
  console.log(`\nOpen: ${session.url}`)
  console.log(session.instructions)
  openUrl(session.url)

  if (session.method === "code") {
    const code = await prompt("\nPaste the code here: ")
    await complete(code)
  } else {
    console.log("\nWaiting for callback...")
    await complete()
  }

  console.log(`${provider.name} login successful!`)
}

async function chat(providerId: string) {
  const provider = client.getProvider(providerId)
  console.log(`\nTesting ${provider.name}...`)
  console.log(`Models: ${provider.models.join(", ")}`)

  const message = await prompt("Message: ")

  console.log(`\nResponse:`)
  const response = await client.chat(providerId, [{ role: "user", content: message }], {
    stream: true,
    onChunk: (chunk: string) => process.stdout.write(chunk),
  })
  console.log()

  if (response.usage) {
    console.log(`\nTokens: ${response.usage.input} in / ${response.usage.output} out`)
  }
}

async function status() {
  console.log("\nStatus:")
  for (const provider of providers) {
    const loggedIn = await provider.isLoggedIn()
    const creds = await client.store.get(provider.id)
    const expired = creds ? creds.expires < Date.now() : false
    const status = !loggedIn ? "not logged in" : expired ? "expired" : "active"
    console.log(`  ${provider.name}: ${status}`)
  }
}

async function main() {
  const providerIds = providers.map(p => p.id)

  while (true) {
    try {
      console.log("\n=== Subscription Auth ===\n")
      console.log("Commands: login <provider>, chat <provider>, status, exit")
      console.log(`Providers: ${providerIds.join(", ")}`)

      const input = (await prompt("\n> ")).split(" ")
      const [cmd, arg] = input

      switch (cmd) {
        case "login":
          if (!arg || !providerIds.includes(arg)) {
            console.log(`Usage: login <${providerIds.join("|")}>`)
          } else {
            await login(arg)
          }
          break
        case "chat":
          if (!arg || !providerIds.includes(arg)) {
            console.log(`Usage: chat <${providerIds.join("|")}>`)
          } else {
            await chat(arg)
          }
          break
        case "status":
          await status()
          break
        case "exit":
        case "quit":
        case "q":
          console.log("Goodbye!")
          rl.close()
          process.exit(0)
        default:
          console.log("Unknown command")
      }
    } catch (error) {
      console.error("\nError:", error instanceof Error ? error.message : error)
    }
  }
}

main()
