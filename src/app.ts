import { DomCtx, DomCtxImpl } from './dom_ctx';
import * as sodium from 'sodiumjs';

class Model {
    cEntries: sodium.Cell<Entry[]>;
    cField: sodium.Cell<string>;
    cUID: sodium.Cell<number>;
    cVisibility: sodium.Cell<string>;

    public constructor(sMsg: sodium.Stream<Msg>) {
        let slEntries = new sodium.StreamLoop<Entry[]>();
        this.cEntries = slEntries.hold([]).tracking(entries => {
            let result: (sodium.Cell<any>|sodium.Stream<any>)[] = [];
            entries.forEach(entry => result.push(entry.cDescription, entry.cCompleted, entry.cEditing));
            return result;
        });
        this.cField =
            sMsg
                .map(msg => {
                    if (msg instanceof MsgUpdateField) {
                        return msg;
                    } else {
                        return null;
                    }
                })
                .filterNotNull()
                .map(msg => msg.value)
                .orElse(
                    sMsg
                        .filter(msg => msg instanceof MsgAdd)
                        .mapTo("")
                )
                .hold("");
        let slUID = new sodium.StreamLoop<number>();
        this.cUID = slUID.hold(0);
        this.cVisibility =
            sMsg
                .map(msg => {
                    if (msg instanceof MsgChangeVisibility) {
                        return msg;
                    } else {
                        return null;
                    }
                })
                .filterNotNull()
                .map(msg => msg.value)
                .hold("All");
        slEntries.loop(
            sMsg
                .filter(msg => msg instanceof MsgAdd)
                .snapshot1(this.cEntries)
                .snapshot3(
                    this.cUID,
                    this.cField,
                    (entries, uid, field) => {
                        if (field.length == 0) {
                            return entries;
                        } else {
                            let entries2 = entries.slice(0);
                            entries2.push(new Entry(uid, field, sMsg));
                            return entries2;
                        }
                    }
                )
                .orElse(
                    sMsg
                        .map(msg => {
                            if (msg instanceof MsgDelete) {
                                return msg;
                            } else {
                                return null;
                            }
                        })
                        .filterNotNull()
                        .map(msg => msg.id)
                        .snapshot(
                            this.cEntries,
                            (id, entries) =>
                                entries.filter(entry => entry.id != id)
                        )
                )
                .orElse(
                    sMsg
                        .map(msg => {
                            if (msg instanceof MsgDeleteComplete) {
                                return msg;
                            } else {
                                return null;
                            }
                        })
                        .filterNotNull()
                        .snapshot1(this.cEntries)
                        .map(entries => entries.filter(entry => !entry.cCompleted.sample()))
                )
        );
        slUID.loop(
            sMsg
                .filter(msg => msg instanceof MsgAdd)
                .snapshot1(this.cUID)
                .map(x => x + 1)
        );
    }
}

class Entry {
    id: number;
    cDescription: sodium.Cell<string>;
    cCompleted: sodium.Cell<boolean>;
    cEditing: sodium.Cell<boolean>;

    public constructor(id: number, initDescription: string, sMsg: sodium.Stream<Msg>) {
        this.id = id;
        this.cDescription =
            sMsg
                .map(msg => {
                    if (msg instanceof MsgUpdateEntry && msg.id == this.id) {
                        return msg;
                    } else {
                        return null;
                    }
                })
                .filterNotNull()
                .map(msg => msg.value)
                .hold(initDescription);
        this.cCompleted =
            sMsg
                .map(msg => {
                    if (msg instanceof MsgCheck && msg.id == this.id) {
                        return msg;
                    } else {
                        return null;
                    }
                })
                .filterNotNull()
                .map(msg => msg.value)
                .orElse(
                    sMsg
                        .map(msg => {
                            if (msg instanceof MsgCheckAll) {
                                return msg;
                            } else {
                                return null;
                            }
                        })
                        .filterNotNull()
                        .map(msg => msg.value)
                )
                .hold(false);
        this.cEditing =
            sMsg
                .map(msg => {
                    if (msg instanceof MsgEditingEntry && msg.id == this.id) {
                        return msg;
                    } else {
                        return null;
                    }
                })
                .filterNotNull()
                .map(msg => msg.value)
                .hold(false);
    }
}

interface Msg {
}

class MsgNoOp implements Msg {}

class MsgUpdateField implements Msg {
    value: string;
    public constructor(value: string) {
        this.value = value;
    }
}

class MsgAdd implements Msg {
}

class MsgCheckAll implements Msg {
    value: boolean;
    public constructor(value: boolean) {
        this.value = value;
    }
}

class MsgCheck implements Msg {
    id: number;
    value: boolean;
    public constructor(id: number, value: boolean) {
        this.id = id;
        this.value = value;
    }
}

class MsgEditingEntry implements Msg {
    id: number;
    value: boolean;
    public constructor(id: number, value: boolean) {
        this.id = id;
        this.value = value;
    }
}

class MsgDelete implements Msg {
    id: number;
    public constructor(id: number) {
        this.id = id;
    }
}

class MsgDeleteComplete implements Msg {
}

class MsgUpdateEntry implements Msg {
    id: number;
    value: string;
    public constructor(id: number, value: string) {
        this.id = id;
        this.value = value;
    }
}

class MsgChangeVisibility implements Msg {
    value: string;
    public constructor(value: string) {
        this.value = value;
    }
}

// VIEW

function view(model: Model, dc: DomCtx<Msg>) {
    dc.beginElement("div");
        dc.attr("class", new sodium.Cell("todomvc-wrapper"));
        dc.attr("style", new sodium.Cell("visibility:hidden;"));
        dc.beginElement("section");
            dc.attr("class", new sodium.Cell("todoapp"));
            viewInput(model.cField, dc);
            viewEntries(model.cVisibility, model.cEntries, dc);
            viewControls(model.cVisibility, model.cEntries, dc);
        dc.endElement();
        infoFooter(dc);
    dc.endElement();
}

function viewInput(cTask: sodium.Cell<string>, dc: DomCtx<Msg>) {
    dc.beginElement("header");
        dc.attr("class", new sodium.Cell("header"));

        dc.beginElement("h1");
            dc.beginElement("text");
                dc.text(new sodium.Cell("todos"));
            dc.endElement();
        dc.endElement();

        dc.beginElement("input");
            dc.attr("class", new sodium.Cell("new-todo"));
            dc.attr("placeholder", new sodium.Cell("What needs to be done?"));
            dc.attr("autofocus", new sodium.Cell("true"));
            dc.attr("value", cTask);
            dc.attr("name", new sodium.Cell("newTodo"));
            dc.on("input", new sodium.Cell((e: Event) => new MsgUpdateField((e.srcElement as HTMLInputElement).value)));
            dc.on("keydown", new sodium.Cell((e: Event) => {
                let e2 = e as KeyboardEvent;
                if (e2.keyCode == 13) {
                    return new MsgAdd();
                }
                return new MsgNoOp();
            }));
        dc.endElement();

    dc.endElement();
}

function viewEntries(cVisibility: sodium.Cell<string>, cEntries: sodium.Cell<Entry[]>, dc: DomCtx<Msg>) {
    let cIsVisible =
        (todo: Entry) =>
            cVisibility.lift(
                todo.cCompleted,
                (visibility: string, completed: boolean) => {
                    switch (visibility) {
                        case "Completed":
                            return completed;
                        case "Active":
                            return !completed;
                        default:
                            return true;
                    }
                }
            );
    let cAllComplete =
        sodium.Cell.switchC(
            cEntries
                .map(
                    entries =>
                        sodium.Cell
                            .liftArray(
                                entries
                                    .map(entry => entry.cCompleted)
                            )
                            .map(completes => {
                                for (let i = 0; i < completes.length; ++i) {
                                    if (!completes[i]) {
                                        return false;
                                    }
                                }
                                return true;
                            })
                )
        );
    let cCssVisibility =
        cEntries.map(entries => entries.length == 0 ? "hidden" : "visible");
    
    let cVisibleEntries =
        sodium.Cell.switchC(
            cEntries.map(
                entries =>
                    sodium.Cell
                        .liftArray(
                            entries.map(entry => cIsVisible(entry).map(visible => visible ? [entry] : []))
                        )
                        .map(x => {
                            let result: Entry[] = [];
                            x.forEach(x2 => x2.forEach(x3 => result.push(x3)));
                            return result;
                        })
            )
        );
    
    dc.beginElement("section");
        dc.attr("class", new sodium.Cell("main"));
        dc.attr("style", cCssVisibility.map(cssVisibility => "visible:" + cssVisibility + ";"));
        dc.beginElement("input");
            dc.attr("class", new sodium.Cell("toggle-all"));
            dc.attr("type", new sodium.Cell("checkbox"));
            dc.attr("name", new sodium.Cell("toggle"));
            dc.checked(cAllComplete);
            dc.on("click", cAllComplete.map(allComplete => (e: Event) => new MsgCheckAll(!allComplete)));
        dc.endElement();
        dc.beginElement("label");
            dc.attr("for", new sodium.Cell("toggle-all"));
            dc.text(new sodium.Cell("Mark all as complete"));
        dc.endElement();
        dc.beginElement("ul");
            dc.attr("class", new sodium.Cell("todo-list"));
            dc.forEach(cVisibleEntries, entry => "" + entry.id, entry => viewEntry(entry, dc));
        dc.endElement();
    dc.endElement();
}

function viewEntry(todo: Entry, dc: DomCtx<Msg>) {
    let cClass =
        todo.cCompleted.lift(
            todo.cEditing,
            (completed, editing) => {
                if (completed) {
                    if (editing) {
                        return "completed,editing";
                    } else {
                        return "completed";
                    }
                } else {
                    if (editing) {
                        return "editing";
                    } else {
                        return "";
                    }
                }
            }
        );
    dc.beginElement("li");
        dc.attr("class", cClass);
        dc.beginElement("div");
            dc.attr("class", new sodium.Cell("view"));
            dc.beginElement("input");
                dc.attr("class", new sodium.Cell("toggle"));
                dc.attr("type", new sodium.Cell("checkbox"));
                dc.checked(todo.cCompleted);
                dc.on("click", todo.cCompleted.map(completed => (e: Event) => new MsgCheck(todo.id, !completed)));
            dc.endElement();
            dc.beginElement("label");
                dc.on("dblclick", new sodium.Cell((e: Event) => new MsgEditingEntry(todo.id, true)));
                dc.text(todo.cDescription);
            dc.endElement();
            dc.beginElement("button");
                dc.attr("class", new sodium.Cell("destroy"));
                dc.on("click", new sodium.Cell((e: Event) => new MsgDelete(todo.id)));
            dc.endElement();
        dc.endElement();
        dc.beginElement("input");
            dc.attr("class", new sodium.Cell("edit"));
            dc.attr("value", todo.cDescription);
            dc.attr("name", new sodium.Cell("title"));
            dc.attr("id", new sodium.Cell("todo-" + todo.id));
            dc.on("input", new sodium.Cell((e: Event) => new MsgUpdateEntry(todo.id, (e.srcElement as HTMLInputElement).value)));
            dc.on("blur", new sodium.Cell((e: Event) => new MsgEditingEntry(todo.id, false)));
            dc.on("keydown", new sodium.Cell((e: Event) => {
                let e2 = e as KeyboardEvent;
                if (e2.keyCode == 13) {
                    return new MsgEditingEntry(todo.id, false);
                }
                return new MsgNoOp();
            }));
        dc.endElement();
    dc.endElement();
}

function viewControls(cVisibility: sodium.Cell<string>, cEntries: sodium.Cell<Entry[]>, dc: DomCtx<Msg>) {
    let cEntriesComplete =
        sodium.Cell
            .switchC(
                cEntries.map(entries =>
                    sodium.Cell
                        .liftArray(entries.map(entry => entry.cCompleted.map(completed => completed ? [entry] : [])))
                        .map(x => {
                            let result: Entry[] = [];
                            x.forEach(x2 => x2.forEach(x3 => result.push(x3)));
                            return result;
                        })
                )
            )
            .map(x => x.length);
    let cEntriesLeft =
        cEntries.lift(
            cEntriesComplete,
            (entries, entriesComplete) => entries.length - entriesComplete
        );
    
    dc.beginElement("footer");
        dc.attr("class", new sodium.Cell("footer"));
        dc.attr("style", cEntries.map(entries => entries.length == 0 ? "display:none;" : "display:block;"));
        viewControlsCount(cEntriesLeft, dc);
        viewControlsFilters(cVisibility, dc);
        viewControlsClear(cEntriesComplete, dc);
    dc.endElement();
}

function viewControlsCount(cEntriesLeft: sodium.Cell<number>, dc: DomCtx<Msg>) {
    let cItem_ = cEntriesLeft.map(entriesLeft => entriesLeft == 1 ? " item" : " items");

    dc.beginElement("span");
        dc.attr("class", new sodium.Cell("todo-count"));
        dc.beginElement("strong");
            dc.text(cEntriesLeft.map(entriesLeft => "" + entriesLeft));
        dc.endElement();
        dc.text(cItem_.map(item_ => item_ + " left"));
    dc.endElement();
}

function viewControlsFilters(cVisibility: sodium.Cell<string>, dc: DomCtx<Msg>) {
    dc.beginElement("ul");
        dc.attr("class", new sodium.Cell("filters"));
        visibilitySwap("#/", "All", cVisibility, dc);
        dc.text(new sodium.Cell(" "));
        visibilitySwap("#/active", "Active", cVisibility, dc);
        dc.text(new sodium.Cell(" "));
        visibilitySwap("#/completed", "Completed", cVisibility, dc);
    dc.endElement();
}

function visibilitySwap(uri: string, visibility: string, cActualVisibility: sodium.Cell<string>, dc: DomCtx<Msg>) {
    dc.beginElement("li");
        dc.on("click", new sodium.Cell((e: Event) => new MsgChangeVisibility(visibility)));
        dc.beginElement("a");
            dc.attr("href", new sodium.Cell(uri));
            dc.attr("class", cActualVisibility.map(actualVisibility => visibility == actualVisibility ? "selected" : ""));
            dc.text(new sodium.Cell(visibility));
        dc.endElement();
    dc.endElement();
}

function viewControlsClear(cEntriesCompleted: sodium.Cell<number>, dc: DomCtx<Msg>) {
    dc.beginElement("button");
        dc.attr("class", new sodium.Cell("clear-completed"));
        dc.attr("style", cEntriesCompleted.map(entriesCompleted => entriesCompleted == 0 ? "visibility:none;" : ""));
        dc.on("click", new sodium.Cell((e: Event) => new MsgDeleteComplete()));
        dc.text(cEntriesCompleted.map(entriesCompleted => "Clear completed (" + entriesCompleted + ")"));
    dc.endElement();
}

function infoFooter(dc: DomCtx<Msg>) {
    dc.beginElement("footer");
        dc.attr("class", new sodium.Cell("info"));
        dc.beginElement("p");
            dc.text(new sodium.Cell("Double-click to edit a todo"));
        dc.endElement();
        dc.beginElement("p");
            dc.text(new sodium.Cell("Hand Transpiled By "));
            dc.beginElement("a");
                dc.attr("href", new sodium.Cell("http://github.com/clinuxrulz/idom-sodium-todo-mvc"));
                dc.text(new sodium.Cell("Clinton Selke"));
            dc.endElement();
            dc.text(new sodium.Cell(", From TodoMVC written by "));
            dc.beginElement("a");
                dc.attr("href", new sodium.Cell("https://github.com/evancz/elm-todomvc"));
                dc.text(new sodium.Cell("Evan Czaplicki"))
            dc.endElement();
        dc.endElement();
        dc.beginElement("p");
            dc.text(new sodium.Cell("Part of "));
            dc.beginElement("a");
                dc.attr("href", new sodium.Cell("http://todomvc.com"));
                dc.text(new sodium.Cell("TodoMVC"));
            dc.endElement();
        dc.endElement();
    dc.endElement();
}

function main() {
    sodium.Transaction.run(() => {
        let domCtx = new DomCtxImpl<Msg>();
        let slMsg = new sodium.StreamLoop<Msg>();
        let model = new Model(slMsg);
        view(model, domCtx);
        let rootElement = domCtx.state.rootElement;
        let disconnect = rootElement.init();
        document.body.appendChild(rootElement.element);
        slMsg.loop(domCtx.sMsg);
    });
}

main();
