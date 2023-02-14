#[macro_use]
extern crate lazy_static;
extern crate console_error_panic_hook;

mod drawing;

use image::{ImageFormat, RgbaImage};
use js_sys::Uint8Array;
use mut_static::MutStatic;
use std::panic;
use wasm_bindgen::{prelude::*, Clamped};
use web_sys::{CanvasRenderingContext2d, ImageData};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[allow(unused_macros)]
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => (crate::log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen(module = "/src/constants.ts")]
extern "C" {
    static PAINT_DECAY_AGE: u32;
    static PAINT_POINT_SIZE: f32;
    static SPLATTER_DRIP_DECAY: f32;
    static SPLATTER_DRIP_WEIGHT: f32;
    static COLOR_PALATE_RS: Vec<f32>;
    static UVMAP_SIZE: u32;
}

#[wasm_bindgen]
#[derive(PartialEq)]
pub enum Letter {
    A,
    L,
    I,
    V,
    E,
}

// Data model
// All drawing data is stored on the wasm heap - it can only be updated via rust code:

pub struct Caches {
    a: Vec<u8>,
    l: Vec<u8>,
    i: Vec<u8>,
    v: Vec<u8>,
    e: Vec<u8>,
}

impl Caches {
    pub fn new() -> Caches {
        let data = Caches {
            a: vec![],
            l: vec![],
            i: vec![],
            v: vec![],
            e: vec![],
        };
        data
    }

    pub fn set_data(&mut self, letter: &Letter, img: Vec<u8>) {
        match letter {
            Letter::A => self.a = img,
            Letter::L => self.l = img,
            Letter::I => self.i = img,
            Letter::V => self.v = img,
            Letter::E => self.e = img,
        }
    }

    pub fn get_data(&self, letter: &Letter) -> &Vec<u8> {
        match letter {
            Letter::A => &self.a,
            Letter::L => &self.l,
            Letter::I => &self.i,
            Letter::V => &self.v,
            Letter::E => &self.e,
        }
    }
}

// Persistence - this is where we actually allocate the structs

lazy_static! {
    pub static ref CACHES: MutStatic<Caches> = MutStatic::from(Caches::new());
}

// API - this is our "public" JS API:

#[wasm_bindgen]
pub fn update_cache(letter: Letter, png_data: Vec<u8>) {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    let img = image::load_from_memory(&png_data).expect("Invalid image data");
    let pixels = img.as_rgba8().unwrap().to_vec();
    let mut caches = CACHES.write().unwrap();
    caches.set_data(&letter, pixels);
}

// Render a pixel map to a png, for use on the server side when creating
// compressed "base" images. This isn't efficient enough to use in client-side
// wasm code, but produces a much smaller output than the client code, which is
// appropriate for storing.
#[wasm_bindgen]
pub fn draw_buffer_png(
    letter: Letter,
    time: f64,
    a_colors: Vec<u8>,
    b_colors: Vec<u8>,
    c_colors: Vec<u8>,
    d_colors: Vec<u8>,
    e_colors: Vec<u8>,
    point_count: usize,
    timestamps: Vec<f64>,
    point_actors: Vec<u32>,
    point_groups: Vec<u32>,
    point_scales: Vec<f32>,
    colors: Vec<u8>,
    x_vals: Vec<f32>,
    y_vals: Vec<f32>,
    splatter_counts: Vec<usize>,
    splatter_sizes: Vec<f32>,
    splatter_x_vals: Vec<f32>,
    splatter_y_vals: Vec<f32>,
) -> Uint8Array {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    let caches = CACHES.read().unwrap();
    let cache = caches.get_data(&letter);
    let width = UVMAP_SIZE.clone();
    let height = UVMAP_SIZE.clone();
    let mut img: RgbaImage;
    if cache.len() == 0 {
        img = RgbaImage::new(width, height);
    } else {
        img = RgbaImage::from_vec(width, height, cache.to_vec()).expect("Bad image in buffers");
    }
    drawing::draw(
        &mut img,
        time,
        &a_colors,
        &b_colors,
        &c_colors,
        &d_colors,
        &e_colors,
        point_count,
        &timestamps,
        &point_actors,
        &point_groups,
        &point_scales,
        &colors,
        &x_vals,
        &y_vals,
        &splatter_counts,
        &splatter_sizes,
        &splatter_x_vals,
        &splatter_y_vals,
    );
    let img = RgbaImage::from_vec(width, height, img.into_vec()).expect("Bad image generated");
    let mut png_data = std::io::Cursor::new(vec![]);
    img.write_to(&mut png_data, ImageFormat::Png)
        .expect("Failed writing png data");
    unsafe { Uint8Array::view(png_data.get_ref()) }
}

#[wasm_bindgen]
pub fn add_points_to_cache(
    letter: Letter,
    ctx: &CanvasRenderingContext2d,
    time: f64,
    a_colors: Vec<u8>,
    b_colors: Vec<u8>,
    c_colors: Vec<u8>,
    d_colors: Vec<u8>,
    e_colors: Vec<u8>,
    point_count: usize,
    timestamps: Vec<f64>,
    point_actors: Vec<u32>,
    point_groups: Vec<u32>,
    point_scales: Vec<f32>,
    colors: Vec<u8>,
    x_vals: Vec<f32>,
    y_vals: Vec<f32>,
    splatter_counts: Vec<usize>,
    splatter_sizes: Vec<f32>,
    splatter_x_vals: Vec<f32>,
    splatter_y_vals: Vec<f32>,
) {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    let mut caches = CACHES.write().unwrap();
    let cache = caches.get_data(&letter);
    let width = UVMAP_SIZE.clone();
    let height = UVMAP_SIZE.clone();
    let mut img: RgbaImage;
    if cache.len() == 0 {
        img = RgbaImage::new(width, height);
    } else {
        img = RgbaImage::from_vec(width, height, cache.to_vec()).expect("Bad image in buffers");
    }
    drawing::draw(
        &mut img,
        time,
        &a_colors,
        &b_colors,
        &c_colors,
        &d_colors,
        &e_colors,
        point_count,
        &timestamps,
        &point_actors,
        &point_groups,
        &point_scales,
        &colors,
        &x_vals,
        &y_vals,
        &splatter_counts,
        &splatter_sizes,
        &splatter_x_vals,
        &splatter_y_vals,
    );
    let data =
        ImageData::new_with_u8_clamped_array_and_sh(Clamped(&mut img.to_vec()), width, height)
            .expect("Bad image data");
    ctx.put_image_data(&data, 0 as f64, 0 as f64)
        .expect("Writing to canvas failed");
    caches.set_data(&letter, img.to_vec());
}

// Per-frame API: when we get new data, draw a buffer which combines our current cache with the provided data.

const LETTERS: [Letter; 5] = [Letter::A, Letter::L, Letter::I, Letter::V, Letter::E];
#[wasm_bindgen]
pub fn draw_buffers(
    ctx_a: &CanvasRenderingContext2d,
    ctx_l: &CanvasRenderingContext2d,
    ctx_i: &CanvasRenderingContext2d,
    ctx_v: &CanvasRenderingContext2d,
    ctx_e: &CanvasRenderingContext2d,
    time: f64,
    a_colors: Vec<u8>,
    b_colors: Vec<u8>,
    c_colors: Vec<u8>,
    d_colors: Vec<u8>,
    e_colors: Vec<u8>,
    point_counts: Vec<usize>,
    timestamps: Vec<f64>,
    point_actors: Vec<u32>,
    point_groups: Vec<u32>,
    point_scales: Vec<f32>,
    colors: Vec<u8>,
    x_vals: Vec<f32>,
    y_vals: Vec<f32>,
    splatter_counts: Vec<usize>,
    splatter_sizes: Vec<f32>,
    splatter_x_vals: Vec<f32>,
    splatter_y_vals: Vec<f32>,
) -> () {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    let width = UVMAP_SIZE.clone();
    let height = UVMAP_SIZE.clone();
    let caches = CACHES.read().unwrap();
    for letter in LETTERS {
        let cache = caches.get_data(&letter);
        let letter_index = match letter {
            Letter::A => 0,
            Letter::L => 1,
            Letter::I => 2,
            Letter::V => 3,
            Letter::E => 4,
        };
        let point_count = point_counts[letter_index];
        let mut point_range_start = 0;
        for idx in 0..letter_index {
            point_range_start += point_counts[idx];
        }
        let point_end_idx = point_range_start + point_count;
        let point_splatter_counts = &splatter_counts[point_range_start..point_end_idx];
        let mut splatter_range_start = 0;
        for idx in 0..point_range_start {
            splatter_range_start += splatter_counts[idx];
        }
        let splatter_end_idx =
            splatter_range_start + point_splatter_counts.into_iter().fold(0, |l, c| l + c);
        let mut img: RgbaImage;
        if cache.len() == 0 {
            img = RgbaImage::new(width, height);
        } else {
            img = RgbaImage::from_vec(width, height, cache.to_vec()).expect("Bad image in caches");
        }
        let ctx = match letter {
            Letter::A => ctx_a,
            Letter::L => ctx_l,
            Letter::I => ctx_i,
            Letter::V => ctx_v,
            Letter::E => ctx_e,
        };
        let changed_rect = drawing::draw(
            &mut img,
            time,
            &a_colors,
            &b_colors,
            &c_colors,
            &d_colors,
            &e_colors,
            point_count,
            &timestamps[point_range_start..point_end_idx],
            &point_actors[point_range_start..point_end_idx],
            &point_groups[point_range_start..point_end_idx],
            &point_scales[point_range_start..point_end_idx],
            &colors[point_range_start..point_end_idx],
            &x_vals[point_range_start..point_end_idx],
            &y_vals[point_range_start..point_end_idx],
            point_splatter_counts,
            &splatter_sizes[splatter_range_start..splatter_end_idx],
            &splatter_x_vals[splatter_range_start..splatter_end_idx],
            &splatter_y_vals[splatter_range_start..splatter_end_idx],
        );

        let (mut pixels, rect_height) = changed_rect.pixel_range(img.to_vec(), width as usize, 4);
        if pixels.len() > 0 {
            // if letter == Letter::I {
            //     console_log!(
            //         "source: {}x{}, pixels: {}, width: {}, height, {} rect: {:?}",
            //         width,
            //         height,
            //         pixels.len(),
            //         changed_rect.width(),
            //         rect_height,
            //         changed_rect,
            //     );
            // }
            let data = ImageData::new_with_u8_clamped_array_and_sh(
                Clamped(&mut pixels[..]),
                changed_rect.width(),
                rect_height,
            )
            .expect("Bad image data");
            ctx.put_image_data(&data, changed_rect.x0 as f64, changed_rect.y0 as f64)
                .expect("Writing to canvas failed");
        }
    }
}
