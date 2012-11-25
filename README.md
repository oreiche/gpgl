Wrapper for General Purpose Computing with WebGL
================================================

Usage
=====

Initialization
--------------

For the initialization of the
GPGL wrapper a HTMLCanvasElement is necessary. If WebGL is not available the initialization will fail and throw an exception. Most mobile platforms do support WebGL, but don't support the extension for floating point textures. You can check for this feature by querying `has_float` if your application depends on it.

    var gpgl;
    try {
        gpgl = new GPGL(document.getElementById("canvas"));
        if (gpgl.has_float === null) {
            alert("Your browsers WebGL implementation does not support floating point textures");
        }
    } catch (err) {
        alert("Your browser does not support WebGL");
    }


Images
------

Arrays can be accessed by the GPU using images. Images reside in GPU
device memory
and therefore need to be allocated explicitly and initialized with the array data.
To create a new image the function `createImage2D(width, height, format [, data])` can be used:

    var ary = [...]; // Size: 1024
    var img = gpgl.createImage2D(16, 16, gpgl.Format.UBYTE8888, ary);

The creation function for images accepts data arrays of type `Array`, `UInt8Array` and `Float32Array`.

To obtain the data from device memory use function `readPixels([decode])`:

    var data = img.readPixels();

There are two different image formats available:

* Format.UBYTE8888
 * Format.FLOAT32

The first one contains a vector of four unsigned byte values. These are typically used for image data containing RGBA values.

The second one contains single 32 bit floating point values. Due to limitations of WebGL images using this format can be read but not written. Instead floating point values need to be encoded and written to an image of the format `Format.UBYTE8888` (see section Kernels, how to encode floats). To obtain float values from a four unsigned byte image set the decode argument for reading the pixels:

    var floats = img.readPixels(true);

Kernels
-------


Limitations
-----------

 * precision
 * shading language
 * writing float

