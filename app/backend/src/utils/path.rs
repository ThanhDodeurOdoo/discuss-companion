// file for path aliases

/// Returns the absolute path to the assets directory
///
/// # Arguments
///
/// * `$path` - The path to the asset file relative to the assets directory
///
/// # Returns
///
/// The absolute path to the asset file
macro_rules! assets {
    ($path:expr) => {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/", $path)
    };
}

pub(crate) use assets;
