import * as sodium from 'sodiumjs';
import { Stack } from 'typescript-collections';

export interface DomCtx<MSG> {

    beginElement(tagName: string): void;

    endElement(): void;

    attr(name: string, value: sodium.Cell<string>): void;

    checked(value: sodium.Cell<boolean>): void;

    text(value: sodium.Cell<string>): void;

    on(eventName: string, handler: sodium.Cell<(e: Event)=>MSG>): void;

    forEach<A>(elements: sodium.Cell<A[]>, keyExtractor: (a:A)=>string, view: (a:A)=>void): void;
}

// Reactive DOM Implementation

export class ElementWrapper {
    element: HTMLElement;
    children: ElementWrapper[];
    inits: (() => (() => void))[];
    public constructor(element: HTMLElement) {
        this.element = element;
        this.children = [];
        this.inits = [];
    }

    public init(): ()=>void {
        let cleanups: (()=>void)[] = [];
        this.inits.forEach(init => cleanups.push(init()));
        this.children.forEach(child => cleanups.push(child.init()));
        return () => cleanups.forEach(cleanup => cleanup());
    }
}

export class DomCtxImplState {
    rootElement: ElementWrapper = null;
    parentElement: ElementWrapper = null;
    currentElement: ElementWrapper = null;
    elementStack: Stack<ElementWrapper> = new Stack();
}

export class DomCtxImpl<MSG> implements DomCtx<MSG> {
    state: DomCtxImplState = new DomCtxImplState();
    stateStack: Stack<DomCtxImplState> = new Stack();
    _sMsg: sodium.StreamSink<MSG> = new sodium.StreamSink();

    public get sMsg(): sodium.Stream<MSG> {
        return this._sMsg;
    }

    private enterSubState() {
        this.stateStack.push(this.state);
        this.state = new DomCtxImplState();
    }

    private leaveSubState(): DomCtxImplState {
        let r = this.state;
        this.state = this.stateStack.pop();
        return r;
    }

    beginElement(tagName: string) {
        this.state.parentElement = this.state.currentElement;
        if (this.state.currentElement != null) {
            this.state.elementStack.push(this.state.currentElement);
        }
        this.state.currentElement = new ElementWrapper(document.createElement(tagName));
        if (this.state.parentElement != null) {
            this.state.parentElement.children.push(this.state.currentElement);
            this.state.parentElement.element.appendChild(this.state.currentElement.element);
        }
    }

    endElement() {
        if (this.state.elementStack.isEmpty()) {
            this.state.rootElement = this.state.currentElement;
            this.state.currentElement = null;
        } else {
            this.state.currentElement = this.state.elementStack.pop();
        }
        this.state.parentElement = this.state.currentElement;
    }

    attr(name: string, value: sodium.Cell<string>) {
        let e = this.state.currentElement;
        e.inits.push(() => {
            let listener = value.listen(x => {
                e.element.setAttribute(name, x);
                (e.element as any)[name] = x;
            });
            return listener;
        });
    }

    checked(value: sodium.Cell<boolean>) {
        let e = this.state.currentElement;
        e.inits.push(() => {
            let listener = value.listen(x => {
                if (x) {
                    if (e.element.hasAttribute("checked")) {
                        return;
                    }
                    (e as any)["checked"] = x;
                    e.element.setAttribute("checked", "");
                } else {
                    if (!e.element.hasAttribute("checked")) {
                        return;
                    }
                    (e as any)["checked"] = x;
                    e.element.removeAttribute("checked");
                }
            });
            return listener;
        });
    }

    text(value: sodium.Cell<string>) {
        let t = document.createTextNode("");
        let e = this.state.currentElement;
        this.state.currentElement.element.appendChild(t);
        e.inits.push(() => {
            let listener = value.listen(x => {
                t.data = x;
            });
            return listener;
        });
    }

    on(eventName: string, handler: sodium.Cell<(e: Event) => MSG>) {
        let e = this.state.currentElement;
        e.inits.push(() => {
            let innerHandler: ((e: Event) => void) = null;
            let listener = handler.listen(x => {
                if (innerHandler != null) {
                    e.element.removeEventListener(eventName, innerHandler);
                }
                innerHandler = (e: Event) => {
                    this._sMsg.send(x(e));
                };
                e.element.addEventListener(eventName, innerHandler);
            });
            return () => {
                listener();
                if (innerHandler != null) {
                    e.element.removeEventListener(eventName, innerHandler);
                }
            };
        });
    }

    forEach<A>(elements: sodium.Cell<A[]>, keyExtractor: (a: A) => string, view: (a: A) => void) {
        this.beginElement("div");
        let d = this.state.currentElement.element;
        this.state.currentElement.inits.push(() => {
            let lastChildren: {[key: string]: {element: ElementWrapper, cleanup: () => void}} = {};
            let listener = elements.listen(elements2 => {
                {
                    let childrenRemoved: {[key: string]: {element: ElementWrapper, cleanup: () => void}} = {};
                    for (let key in lastChildren) {
                        if (!lastChildren.hasOwnProperty(key)) {
                            continue;
                        }
                        childrenRemoved[key] = lastChildren[key];
                    }
                    for (let i = 0; i < elements2.length; ++i) {
                        let element = elements2[i];
                        let key = keyExtractor(element);
                        delete childrenRemoved[key];
                    }
                    for (let key in childrenRemoved) {
                        if (!childrenRemoved.hasOwnProperty(key)) {
                            continue;
                        }
                        let x = childrenRemoved[key];
                        (x.cleanup)();
                    }
                }
                while (d.lastChild != undefined) {
                    d.removeChild(d.lastChild);
                }
                let nextChildren: {[key: string]: {element: ElementWrapper, cleanup: () => void}} = {};
                for (let i = 0; i < elements2.length; ++i) {
                    let element = elements2[i];
                    let key = keyExtractor(element);
                    let e2 = lastChildren[key];
                    if (e2 != undefined) {
                        d.appendChild(e2.element.element);
                        nextChildren[key] = e2;
                    } else {
                        this.enterSubState();
                        view(element);
                        let subState = this.leaveSubState();
                        d.appendChild(subState.rootElement.element);
                        nextChildren[key] = {element: subState.rootElement, cleanup: (subState.rootElement.init)() };
                    }
                }
                lastChildren = nextChildren;
            });
            return () => {
                listener();
                for (let key in lastChildren) {
                    if (!lastChildren.hasOwnProperty(key)) {
                        continue;
                    }
                    (lastChildren[key].cleanup)();
                }
            };
        });
        this.endElement();
    }
}
