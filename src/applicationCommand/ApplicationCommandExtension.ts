import chalk from 'chalk'
import type { Mutable } from 'utility-types'
import type {
  ApplicationCommandData,
  ApplicationCommandSubCommandData,
  ApplicationCommandSubGroupData,
  ChatInputApplicationCommandData,
  Interaction,
  Snowflake,
  ApplicationCommandOptionData,
} from 'discord.js'
import { Attachment, ChatInputCommandInteraction, Collection, CommandInteraction, MessageContextMenuCommandInteraction, UserContextMenuCommandInteraction } from 'discord.js'
import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10'
import { ApplicationCommandComponent } from './ApplicationCommand'
import { ApplicationCommandOption } from './ApplicationCommandOption'
import { listener } from '../core'
import { argConverter } from '../core'
import { CTSExtension } from '../core/extensions/CTSExtension'

type MutableGroup = ChatInputApplicationCommandData & {
  options: Mutable<ChatInputApplicationCommandData['options']>
}

type MutableSubGroup = ApplicationCommandSubGroupData & {
  options: Mutable<ApplicationCommandSubGroupData['options']>
}

type MutableCommand = ChatInputApplicationCommandData & {
  options: ApplicationCommandOptionData[]
}

export type ApplicationCommandExtensionConfig = {
  guilds?: Snowflake[]
}

export class ApplicationCommandExtension extends CTSExtension {
  constructor(public config: ApplicationCommandExtensionConfig) {
    super()
  }

  unmanagedCommands: (ApplicationCommandData & { guilds?: Snowflake[] })[] = []

  // noinspection JSUnusedGlobalSymbols
  registerUnmanagedCommand(command: ApplicationCommandData & { guilds?: Snowflake[] }) {
    this.unmanagedCommands.push(command)
  }

  @listener({ event: 'interactionCreate' })
  async interactionCreate(i: Interaction) {
    try {
      if (!i.isCommand()) return

      let cmd: ApplicationCommandComponent | null = null
      let ext: object | null = null

      const extensions = this.commandClient.registry.extensions

      let subcommand: string | null = null
      let subcommandGroup: string | null = null

      if (i.isChatInputCommand()) {
        subcommand = i.options.getSubcommand(false)
        subcommandGroup = i.options.getSubcommandGroup(false)
      }

      extLoop: for (const extension of extensions) {
        const components = this.commandClient.registry.getComponentsWithType<ApplicationCommandComponent>(extension, ApplicationCommandComponent)

        if (subcommand) {
          for (const command of components) {
            if (!command.subcommandGroup && !command.subcommandGroupChild) continue

            if (
              command.subcommandGroupChild &&
              command.subcommandGroupChild.parent.options.name === i.commandName &&
              command.subcommandGroupChild.options.name === subcommandGroup &&
              command.options.name === subcommand
            ) {
              ext = extension
              cmd = command
              break extLoop
            }
            if (command.subcommandGroup && !subcommandGroup && command.subcommandGroup.options.name === i.commandName && command.options.name === subcommand) {
              ext = extension
              cmd = command
              break extLoop
            }
          }
        } else {
          for (const command of components) {
            if (command.options.name === i.commandName) {
              ext = extension
              cmd = command
              break extLoop
            }
          }
        }
      }

      if (cmd && ext) {
        const argList: unknown[] = []

        await this.convertArguments(ApplicationCommandComponent, argList, cmd.argTypes, () => [i])

        for (const [idx, arg] of cmd.argTypes) {
          let value: unknown = null

          for (const decorator of arg.decorators) {
            if (decorator instanceof ApplicationCommandOption) {
              if ([ApplicationCommandOptionType.Subcommand, ApplicationCommandOptionType.SubcommandGroup].includes(decorator.options.type) && i.isChatInputCommand()) {
                if (decorator.options.type === ApplicationCommandOptionType.Subcommand) {
                  value = i.options.getSubcommand() === decorator.options.name
                  break
                }
                if (decorator.options.type === ApplicationCommandOptionType.SubcommandGroup) {
                  value = i.options.getSubcommandGroup() === decorator.options.name
                  break
                }
              }

              switch (decorator.options.type) {
                case ApplicationCommandOptionType.Attachment:
                  value = i.options.getAttachment(decorator.options.name, decorator.options.required)
                  break
                default:
                  value = i.options.get(decorator.options.name)?.value
                  break
              }

              break
            }
          }

          if (value) {
            argList[idx] = value
          }
        }

        try {
          await cmd.executeGlobalHook(ext, 'beforeApplicationCommandCall', [i])
          await cmd.execute(ext, argList, [i])
        } finally {
          await cmd.executeGlobalHook(ext, 'afterApplicationCommandCall', [i])
        }
      }
    } catch (e) {
      this.commandClient.emit('applicationCommandInvokeError', e, i)
    }
  }

  async sync() {
    const client = this.commandClient

    this.logger.info('Trying to sync commands...')

    let commands: ApplicationCommandData[] = []

    const guildCommands = new Collection<Snowflake, ApplicationCommandData[]>()

    const subcommandGroups = new Collection<string, ChatInputApplicationCommandData>()

    for (const command of client.registry.getComponentsWithTypeGlobal<ApplicationCommandComponent>(ApplicationCommandComponent)) {
      if (command.subcommandGroup) {
        let group = subcommandGroups.get(command.subcommandGroup.options.name) as MutableGroup

        if (!group) {
          group = {
            ...command.subcommandGroup.options,
            type: ApplicationCommandType.ChatInput,
          } as MutableGroup

          if (command.subcommandGroup.guilds) {
            for (const guild of command.subcommandGroup.guilds) {
              let commands = guildCommands.get(guild)
              if (!commands) {
                commands = []
                guildCommands.set(guild, commands)
              }
            }
          } else {
            commands.push(group)
          }

          subcommandGroups.set(command.subcommandGroup.options.name, group)
        }

        if (!group.options) group.options = []

        const options = []

        for (const [, arg] of command.argTypes) {
          const option = arg.decorators.find((x) => x.constructor === ApplicationCommandOption) as ApplicationCommandOption

          if (option) {
            options.push(option.options)
          }
        }

        group.options.push({ ...command.options, type: ApplicationCommandOptionType.Subcommand, options } as Mutable<ApplicationCommandSubCommandData>)

        continue
      } else if (command.subcommandGroupChild) {
        const parent = command.subcommandGroupChild.parent
        let group = subcommandGroups.get(parent.options.name) as MutableGroup

        if (!group) {
          group = {
            ...parent.options,
            type: ApplicationCommandType.ChatInput,
          } as MutableGroup

          if (parent.guilds) {
            for (const guild of parent.guilds) {
              let commands = guildCommands.get(guild)
              if (!commands) {
                commands = []
                guildCommands.set(guild, commands)
              }
            }
          } else {
            commands.push(group)
          }

          subcommandGroups.set(parent.options.name, group)
        }

        if (!group.options) group.options = []

        let child = group.options.find((x) => x.name === command.subcommandGroupChild?.options.name) as MutableSubGroup

        if (!child) {
          child = {
            ...(command.subcommandGroupChild.options as Omit<ApplicationCommandSubGroupData, 'type'>),
            type: ApplicationCommandOptionType.SubcommandGroup,
          } as MutableSubGroup
          group.options.push(child)
        }

        if (!child.options) child.options = []

        const options = []

        for (const [, arg] of command.argTypes) {
          const option = arg.decorators.find((x) => x.constructor === ApplicationCommandOption) as ApplicationCommandOption

          if (option) {
            options.push(option.options)
          }
        }

        child.options.push({ ...command.options, type: ApplicationCommandOptionType.Subcommand, options } as Mutable<ApplicationCommandSubCommandData>)

        continue
      }

      const cmd = { ...command.options } as MutableCommand

      if (cmd.type === ApplicationCommandType.ChatInput) {
        cmd.options = []

        for (const [, arg] of command.argTypes) {
          const option = arg.decorators.find((x) => x.constructor === ApplicationCommandOption) as ApplicationCommandOption

          if (option) {
            cmd.options.push(option.options)
          }
        }
      }

      await command.executeHook(this, 'beforeSync', [cmd, command])

      if (command.options.guilds) {
        for (const guild of command.options.guilds) {
          let commands = guildCommands.get(guild)
          if (!commands) {
            commands = []
            guildCommands.set(guild, commands)
          }
          commands.push(cmd)
        }
        continue
      }

      commands.push(cmd)
    }

    for (const { guilds, ...rest } of this.unmanagedCommands) {
      if (guilds) {
        for (const guild of guilds) {
          let commands = guildCommands.get(guild)
          if (!commands) {
            commands = []
            guildCommands.set(guild, commands)
          }
          commands.push(rest)
        }
      } else {
        commands.push(rest)
      }
    }

    if (this.config.guilds) {
      for (const guild of this.config.guilds) {
        let g = guildCommands.get(guild)
        if (!g) {
          g = []
          guildCommands.set(guild, g)
        }
        g.push(...commands)
      }

      commands = []
    }

    if (guildCommands.size) {
      for (const [guild, commands] of guildCommands) {
        try {
          const g = await this.client.guilds.fetch(guild)
          await g.fetch()
          this.logger.info(
            `Processing ${chalk.green(commands.length)} commands(${commands.map((x) => chalk.blue(x.name)).join(', ')}) for guild ${chalk.green(g.name)}(${chalk.blue(g.id)})`,
          )

          await g.commands.set(commands)

          this.logger.info(`Successfully registered commands for guild ${chalk.green(g.name)}(${chalk.blue(g.id)})`)
        } catch (e) {
          this.logger.error(`Failed to register commands to guild ${chalk.green(guild)}: ${(e as Error).message}`)
        }
      }
    }
    if (commands.length) {
      try {
        this.logger.info(`Processing ${chalk.green(commands.length)} commands(${commands.map((x) => chalk.blue(x.name)).join(', ')}) for application scope...`)

        if (this.client.application) {
          await this.client.application.commands.set(commands)

          this.logger.info('Successfully registered commands.')
        } else {
          this.logger.error('Client#application is not yet initialized.')
        }
      } catch (e) {
        this.logger.error(`Failed to register commands to global: ${(e as Error).message}`)
      }
    }
  }

  @argConverter({
    component: ApplicationCommandComponent,
    parameterless: true,
    type: ChatInputCommandInteraction,
  })
  async chatInteraction(i: ChatInputCommandInteraction) {
    return i
  }

  @argConverter({
    component: ApplicationCommandComponent,
    parameterless: true,
    type: MessageContextMenuCommandInteraction,
  })
  async messageInteraction(i: MessageContextMenuCommandInteraction) {
    return i
  }

  @argConverter({
    component: ApplicationCommandComponent,
    parameterless: true,
    type: UserContextMenuCommandInteraction,
  })
  async userInteraction(i: UserContextMenuCommandInteraction) {
    return i
  }

  @argConverter({
    component: ApplicationCommandComponent,
    parameterless: true,
    type: CommandInteraction,
  })
  async commandInteraction(i: UserContextMenuCommandInteraction) {
    return i
  }

  @argConverter({
    component: ApplicationCommandComponent,
    type: Attachment,
  })
  async attachment() {}
}
