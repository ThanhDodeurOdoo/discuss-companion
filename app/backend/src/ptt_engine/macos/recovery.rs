use anyhow::Result;

/// Owns a listener through permission loss and retries. `reset` releases PTT
/// before the old listener is dropped, including when replacement fails.
pub(super) fn reconcile<T>(
    listener: &mut Option<T>,
    permitted: bool,
    retry: bool,
    healthy: impl Fn(&T) -> bool,
    mut create: impl FnMut() -> Result<T>,
    mut reset: impl FnMut(),
) -> Result<bool> {
    let running = listener.as_ref().is_some_and(&healthy);
    if listener.is_some() && (!permitted || retry || !running) {
        reset();
        *listener = None;
    }
    if !permitted {
        return Ok(false);
    }
    if listener.is_none() {
        let candidate = create()?;
        if !healthy(&candidate) {
            return Ok(false);
        }
        *listener = Some(candidate);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    struct Listener(Rc<RefCell<Vec<&'static str>>>);
    impl Drop for Listener {
        fn drop(&mut self) {
            self.0.borrow_mut().push("drop");
        }
    }

    #[test]
    fn grants_revoke_and_regrant_without_duplicate_capture() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let mut listener = None;
        let create = || {
            events.borrow_mut().push("create");
            Ok(Listener(Rc::clone(&events)))
        };
        let reset = || events.borrow_mut().push("release");
        assert!(!reconcile(&mut listener, false, false, |_| true, create, reset).unwrap());
        assert!(events.borrow().is_empty());
        assert!(reconcile(&mut listener, true, false, |_| true, create, reset).unwrap());
        assert!(reconcile(&mut listener, true, false, |_| true, create, reset).unwrap());
        assert!(!reconcile(&mut listener, false, false, |_| true, create, reset).unwrap());
        assert!(reconcile(&mut listener, true, false, |_| true, create, reset).unwrap());
        assert_eq!(*events.borrow(), ["create", "release", "drop", "create"]);
    }

    #[test]
    fn retry_releases_before_drop_and_failure_can_recover() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let mut listener = Some(Listener(Rc::clone(&events)));
        assert!(
            reconcile(
                &mut listener,
                true,
                true,
                |_| true,
                || Err(anyhow::anyhow!("create failed")),
                || events.borrow_mut().push("release")
            )
            .is_err()
        );
        assert!(listener.is_none());
        assert_eq!(*events.borrow(), ["release", "drop"]);
        assert!(
            reconcile(
                &mut listener,
                true,
                false,
                |_| true,
                || Ok(Listener(Rc::clone(&events))),
                || {}
            )
            .unwrap()
        );
    }

    #[test]
    fn disabled_or_keyboard_stripped_candidates_are_dropped() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let mut listener = Some(Listener(Rc::clone(&events)));
        assert!(
            !reconcile(
                &mut listener,
                true,
                false,
                |_| false,
                || Ok(Listener(Rc::clone(&events))),
                || events.borrow_mut().push("release")
            )
            .unwrap()
        );
        assert!(listener.is_none());
        assert_eq!(*events.borrow(), ["release", "drop", "drop"]);
    }
}
