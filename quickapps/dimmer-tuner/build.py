#!/usr/bin/env python3
"""Build dimmer-tuner.fqa from main.lua.

The view follows the shape of a working QuickApp on this gateway (Shading,
5.220.15): `viewLayout` in $jason form, `uiView` with eventBindings that call
UIAction, and `uiCallbacks`. Every select carries selectionType and an ARRAY
`values` — without them HC3 serves an empty tile.

    python3 quickapps/dimmer-tuner/build.py   ->  quickapps/dimmer-tuner/dimmer-tuner.fqa
"""
import json, pathlib

HERE = pathlib.Path(__file__).parent

# Rows: each a list of (type, name, text). Buttons in one row share it.
ROWS = [
    [("label", "statusLabel", "Starting…")],
    [("select", "dimmerPicker", "DIMMER")],
    [("label", "infoLabel", "No dimmer selected")],
    [("button", "startButton", "Start: light to its lowest level")],
    [("button", "lowerButton", "◀ Lower"), ("button", "higherButton", "Higher ▶")],
    [("button", "saveButton", "Save"), ("button", "cancelButton", "Cancel")],
    [("button", "rescanButton", "Reload dimmer list")],
]

BUTTON_EVENTS = ["onReleased", "onLongPressDown", "onLongPressReleased"]


def comp(kind, name, text, weight, bound):
    c = {"name": name, "style": {"weight": weight}, "text": text, "type": kind, "visible": True}
    if kind == "select":
        c.update({"options": [{"type": "option", "text": "(scanning…)", "value": "0"}],
                  "selectionType": "single", "values": []})
        if bound:
            c["eventBinding"] = {"onToggled": [{"params": {"actionName": "UIAction",
                                 "args": ["onToggled", name, "$event.value"]}, "type": "deviceAction"}]}
    elif kind == "button" and bound:
        c["eventBinding"] = {e: [{"params": {"actionName": "UIAction", "args": [e, name]},
                                  "type": "deviceAction"}] for e in BUTTON_EVENTS}
    return c


def view_layout():
    items = []
    for row in ROWS:
        w = f"{1 / len(row):.2f}" if len(row) > 1 else "1.0"
        if len(row) == 1 and row[0][0] in ("label", "select"):
            inner = [comp(*row[0], "1.2", False)]
        else:
            inner = [{"components": [comp(k, n, t, w, False) for k, n, t in row],
                      "style": {"weight": "1.2"}, "type": "horizontal"}]
        items.append({"components": inner + [{"style": {"weight": "0.5"}, "type": "space"}],
                      "style": {"weight": "1.2"}, "type": "vertical"})
    return {"$jason": {"body": {"header": {"style": {"height": "0"}, "title": "Dimmer Tuner"},
                                "sections": {"items": items}}, "head": {"title": "Dimmer Tuner"}}}


def ui_view():
    out = []
    for row in ROWS:
        w = f"{1 / len(row):.2f}" if len(row) > 1 else "1.0"
        out.append({"components": [comp(k, n, t, w, True) for k, n, t in row],
                    "style": {"weight": "1.0"}, "type": "horizontal"})
    return out


def ui_callbacks():
    cbs = []
    for row in ROWS:
        for kind, name, _ in row:
            if kind == "button":
                cbs.append({"callback": "UIAction", "eventType": "onReleased", "name": name})
            elif kind == "select":
                for e in ("onToggled", "onChanged", "onReleased"):
                    cbs.append({"callback": "UIAction", "eventType": e, "name": name})
    return cbs


fqa = {
    "name": "Dimmer Tuner",
    "type": "com.fibaro.genericDevice",
    "apiVersion": "1.3",
    "initialInterfaces": ["quickApp"],
    "initialProperties": {
        "viewLayout": view_layout(),
        "uiView": ui_view(),
        "uiCallbacks": ui_callbacks(),
        "quickAppVariables": [
            {"name": "step", "type": "string", "value": "2"},
            {"name": "margin", "type": "string", "value": "2"},
            {"name": "dimmers", "type": "string", "value": "[]"},
        ],
        "typeTemplateInitialized": True,
    },
    "files": [{"name": "main", "isMain": True, "isOpen": False, "type": "lua",
               "content": (HERE / "main.lua").read_text()}],
}

out = HERE / "dimmer-tuner.fqa"
out.write_text(json.dumps(fqa, ensure_ascii=False, indent=1))
print(out)
