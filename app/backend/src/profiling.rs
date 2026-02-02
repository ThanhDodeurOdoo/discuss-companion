#[cfg(any(feature = "dhat-heap", feature = "dhat-ad-hoc"))]
#[doc(hidden)]
#[macro_export]
macro_rules! profiling_init {
    () => {
        $crate::profiling::enabled::init_dhat_profiler();
    };
}

#[cfg(not(any(feature = "dhat-heap", feature = "dhat-ad-hoc")))]
#[doc(hidden)]
#[macro_export]
macro_rules! profiling_init {
    () => {};
}

#[cfg(any(feature = "dhat-heap", feature = "dhat-ad-hoc"))]
#[doc(hidden)]
#[macro_export]
macro_rules! profiling_drop {
    () => {
        $crate::profiling::enabled::drop_dhat_profiler();
    };
}

#[cfg(not(any(feature = "dhat-heap", feature = "dhat-ad-hoc")))]
#[doc(hidden)]
#[macro_export]
macro_rules! profiling_drop {
    () => {};
}

#[cfg(any(feature = "dhat-heap", feature = "dhat-ad-hoc"))]
pub(crate) mod enabled {
    use std::{
        fs,
        path::PathBuf,
        sync::{Mutex, OnceLock},
    };

    use tracing::warn;

    #[cfg(feature = "dhat-heap")]
    #[global_allocator]
    static ALLOC: dhat::Alloc = dhat::Alloc;

    static DHAT_PROFILER: OnceLock<Mutex<Option<dhat::Profiler>>> = OnceLock::new();

    fn dhat_output_path() -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let profiling_dir = manifest_dir.join("..").join("profiling");
        if let Err(err) = fs::create_dir_all(&profiling_dir) {
            warn!("Failed to create profiling directory: {err}");
        }
        let file_name = if cfg!(feature = "dhat-heap") {
            "dhat-heap.json"
        } else {
            "dhat-ad-hoc.json"
        };
        profiling_dir.join(file_name)
    }

    pub(crate) fn init_dhat_profiler() {
        let output_path = dhat_output_path();
        let profiler = if cfg!(feature = "dhat-heap") {
            dhat::Profiler::builder().file_name(&output_path).build()
        } else {
            dhat::Profiler::builder()
                .ad_hoc()
                .file_name(&output_path)
                .build()
        };
        let holder = DHAT_PROFILER.get_or_init(|| Mutex::new(None));
        if let Ok(mut profiler_slot) = holder.lock() {
            *profiler_slot = Some(profiler);
            warn!(
                "DHAT profiling enabled; output will be written to {}",
                output_path.display()
            );
        }
    }

    pub(crate) fn drop_dhat_profiler() {
        if let Some(holder) = DHAT_PROFILER.get()
            && let Ok(mut profiler_slot) = holder.lock()
            && profiler_slot.is_some()
        {
            let output_path = dhat_output_path();
            profiler_slot.take();
            warn!(
                "DHAT profiling finished; output written to {}",
                output_path.display()
            );
        }
    }
}
