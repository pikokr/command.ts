import { Collection } from 'discord.js'
import { Module } from '../structures/Module'
import { Listener, ListenerDecorator } from '../types'
import { LISTENERS_KEY } from '../constants'
import { CommandClient } from '../structures/CommandClient'

export class ListenerManager {
  listeners: Collection<Module, Listener[]> = new Collection()

  constructor(private client: CommandClient) {}

  register(module: Module) {
    const meta: ListenerDecorator[] | undefined = Reflect.getMetadata(
      LISTENERS_KEY,
      module,
    )
    if (!meta) return
    const listenersList: string[] = []
    this.listeners.forEach((value) =>
      listenersList.push(...value.map((x) => x.id)),
    )
    if (meta.find((x) => listenersList.find((y) => y === x.id)))
      throw new Error('해당 ID의 리스너가 이미 존재합니다.')

    const listeners: Listener[] = meta.map((x) => ({
      id: x.id,
      module,
      event: x.event,
      wrapper: (...args: any[]) =>
        Reflect.get(module, x.key).apply(module, args),
    }))

    listeners.forEach((listener) =>
      this.client.on(listener.event, listener.wrapper),
    )

    this.listeners.set(module, listeners)
  }

  unregister(module: Module) {
    const listeners = this.listeners.get(module)

    if (!listeners) return

    for (const listener of listeners) {
      this.client.removeListener(listener.event, listener.wrapper)
    }

    this.listeners.delete(module)
  }
}