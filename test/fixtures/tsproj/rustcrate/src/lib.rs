/// Squared distance between two points.
pub fn dist2(ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}

#[wasm_bindgen]
pub fn nearest(x: f32, y: f32) -> f32 {
    dist2(x, y, 0.0, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dist2_is_zero_at_origin() {
        assert_eq!(dist2(0.0, 0.0, 0.0, 0.0), 0.0);
    }
}
