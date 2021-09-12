import { Module, Registry } from '../structures'
import { Collection, Guild, Snowflake } from 'discord.js'
import {
  CheckFunction,
  ISlashCommandDecorator,
  RequiredPermissions,
  SlashCommand,
} from '../types'
import {
  COMMANDS_CHECK_KEY,
  COMMANDS_CLIENT_PERMISSIONS_KEY,
  COMMANDS_OWNER_ONLY_KEY,
  COMMANDS_USER_PERMISSIONS_KEY,
  SLASH_COMMANDS_KEY,
} from '../constants'

/**
 * Slash Command Manager.
 */
export class SlashCommandManager {
  constructor(private registry: Registry) {}

  /**
   * Collection of slash commands
   */
  commands: Collection<Module, SlashCommand[]> = new Collection()

  /**
   * Get List of slash commands
   */
  get commandList(): SlashCommand[] {
    const result: SlashCommand[] = []
    this.commands.forEach((x) => result.push(...x))
    return result
  }

  /**
   * Auto-Refresh slash command list if `autoRegister` config enabled on client
   */
  async refreshCommands() {
    const c = this.registry.client

    const app = c.application!

    if (c.commandOptions.slashCommands.autoRegister) {
      console.log('[command.ts] Updating commands...')
      if ('guild' in c.commandOptions.slashCommands) {
        const processForGuild = async (guildID: Snowflake) => {
          console.log(`[command.ts] Target Guild ID: ${guildID}`)
          const guild = c.guilds.cache.get(guildID)
          if (!guild)
            return console.log(
              `[command.ts] ${guildID} Command creation cancelled.`,
            )
          await guild.commands.set(
            this.commandList.map((x) => ({
              name: x.name,
              description: x.description,
              options: x.options,
              defaultPermission: !x.ownerOnly,
            })),
          )

          for (const [, command] of guild.commands.cache.filter(
            (x) =>
              this.commandList.find((y) => x.name === y.name)?.ownerOnly ||
              false,
          )) {
            await command.permissions.set({
              permissions: this.registry.client.owners.map((x) => ({
                type: 'USER',
                id: x,
                permission: true,
              })),
            })
          }
        }
      } else {
        console.log(`[command.ts] Target: Global`)
        await app.commands.set(
          this.commandList.map((x) => ({
            name: x.name,
            description: x.description,
            options: x.options,
            defaultPermission: !x.ownerOnly,
          })),
        )
        for (const [, command] of app.commands.cache.filter(
          (x) =>
            this.commandList.find((y) => x.name === y.name)?.ownerOnly || false,
        )) {
          await command.permissions.set({
            permissions: this.registry.client.owners.map((x) => ({
              type: 'USER',
              id: x,
              permission: true,
            })),
            guild: (this.registry.client.commandOptions.slashCommands as any)
              .ownerCommandGuild,
          })
        }
      }
    }
  }

  private registerCommands(module: Module) {
    const decorators: ISlashCommandDecorator[] = Reflect.getMetadata(
      SLASH_COMMANDS_KEY,
      module,
    )
    if (!decorators) return

    const ownerOnlyKeys: Set<string> =
      Reflect.getMetadata(COMMANDS_OWNER_ONLY_KEY, module) || new Set()

    const commands: SlashCommand[] = decorators.map((v) => {
      const checks: CheckFunction[] =
        Reflect.getMetadata(COMMANDS_CHECK_KEY, module, v.key) || []
      const userPerms: RequiredPermissions = Reflect.getMetadata(
        COMMANDS_USER_PERMISSIONS_KEY,
        module,
        v.key,
      ) || { permissions: [] }

      const clientPerms: RequiredPermissions = Reflect.getMetadata(
        COMMANDS_CLIENT_PERMISSIONS_KEY,
        module,
        v.key,
      ) || { permissions: [] }

      return {
        module: module,
        name: v.name,
        execute: Reflect.get(module, v.key),
        description: v.description,
        options: v.options,
        userPermissions: userPerms.permissions,
        clientPermissions: clientPerms.permissions,
        checks,
        ownerOnly: ownerOnlyKeys.has(v.key),
      }
    })
    this.commands.set(module, commands)
  }

  /**
   * This method is run by Registry. You don't have to run it manually.
   * @param module
   */
  register(module: Module) {
    this.registerCommands(module)
  }

  /**
   * This method is run by Registry. You don't have to run it manually.
   * @param module
   */
  unregister(module: Module) {
    this.commands.delete(module)
  }
}
