import {BaseComponent, createComponentDecorator} from "../../core";

export interface Interaction {
    customId: string
    receiveType: "Button" | "SelectMenu"
}

export class InteractionComponent extends BaseComponent {
    option: Interaction
    constructor(x: Interaction) {
        super()
        this.option = x
    }
}

export const interaction = (x: Interaction) => createComponentDecorator(new InteractionComponent(x))