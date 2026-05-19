import {
  Menu,
  MenuItem,
  Submenu,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";

export async function setupMenu(onPreferences: () => void) {
  const preferences = await MenuItem.new({
    id: "preferences",
    text: "Preferences...",
    accelerator: "CmdOrCtrl+,",
    action: onPreferences,
  });

  const separator = await PredefinedMenuItem.new({ item: "Separator" });
  const quit = await PredefinedMenuItem.new({
    item: "Quit",
    text: "Quit Deep Search",
  });

  const appSubmenu = await Submenu.new({
    text: "Deep Search",
    items: [preferences, separator, quit],
  });

  const editSeparator = await PredefinedMenuItem.new({ item: "Separator" });

  const editSubmenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo", text: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo", text: "Redo" }),
      editSeparator,
      await PredefinedMenuItem.new({ item: "Cut", text: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy", text: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste", text: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll", text: "Select All" }),
    ],
  });

  const menu = await Menu.new({
    id: "app-menu",
    items: [appSubmenu, editSubmenu],
  });

  await menu.setAsAppMenu();
}
