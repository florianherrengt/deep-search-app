import {
  Menu,
  MenuItem,
  Submenu,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";

export interface ZoomActions {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export async function setupMenu(
  onPreferences: () => void,
  onNewChat: () => void,
  zoom: ZoomActions,
) {
  const newChat = await MenuItem.new({
    id: "new-chat",
    text: "New Chat",
    accelerator: "CmdOrCtrl+N",
    action: onNewChat,
  });

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
    items: [newChat, separator, preferences, separator, quit],
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

  const viewSubmenu = await Submenu.new({
    text: "View",
    items: [
      await MenuItem.new({
        id: "zoom-in",
        text: "Zoom In",
        accelerator: "CmdOrCtrl+=",
        action: zoom.onZoomIn,
      }),
      await MenuItem.new({
        id: "zoom-out",
        text: "Zoom Out",
        accelerator: "CmdOrCtrl+-",
        action: zoom.onZoomOut,
      }),
      await MenuItem.new({
        id: "zoom-actual-size",
        text: "Actual Size",
        accelerator: "CmdOrCtrl+0",
        action: zoom.onResetZoom,
      }),
    ],
  });

  const menu = await Menu.new({
    id: "app-menu",
    items: [appSubmenu, editSubmenu, viewSubmenu],
  });

  await menu.setAsAppMenu();
}
