use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AppVisibilityMode {
    #[default]
    TrayAndDockWhenWindowOpen,
    TrayAndDockAlways,
    DockOnly,
}
