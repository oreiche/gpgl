Wrapper for General Purpose Computing with WebGL
================================================

GPGL is a simple wrapper library for JavaScript enabling general purpose computations on GPUs using WebGL. It is the aim of the wrapper to offer an API similar to OpenCL.

Initialization
==============

For the initialization of the
GPGL wrapper a HTMLCanvasElement is necessary to obtain the WebGL rendering context. If WebGL is not available the initialization will fail and throw an exception. Most mobile platforms do support WebGL, but don't support the extension for floating point textures. You can check for this feature by querying `has_float` if your application depends on it.

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
======

Arrays that can be accessed by the GPU are called images. An image resides within GPU
device memory.
It therefore needs to be allocated explicitly and can then be initialized with the array data.
To create a new image the function `createImage2D(width, height, format [, data] [, linear])` can be used:

    var ary = [...]; // Size: 1024
    var img = gpgl.createImage2D(16, 16, gpgl.Format.UBYTE8888, ary);

The creation function for images accepts arrays of the type `Array`, `UInt8Array` and `Float32Array` as initial data.

To obtain the data from device memory use the function `readPixels([decode])`:

    var data = img.readPixels();

There are two different image formats available:

 * `Format.UBYTE8888`
 * `Format.FLOAT32`

The first one contains a vector of four unsigned byte values. These are typically used for image data containing RGBA values each within the range [0; 255].

The second one contains single 32 bit floating point values and is only available if the WebGL extension for floating point textures is supported. Due to limitations of WebGL images using this format can be read but not written. Instead floating point values need to be encoded and written to an image of the format `Format.UBYTE8888` (see section Kernels, how to encode floats). To recover the float values from a unsigned byte image set the decode argument for reading the pixels:

    var floats = img.readPixels(true);

Unfortunately WebGL does not provide full single precision floating point. Hence the increased maximum relative error is equal to 2^{-16}.

Kernels
=======

Kernels are written in OpenGL ES 2.0 Shading Language Version 1.00.

Source
------

Kernels can be created using the function `createKenel(source)`.
The kernel source code must be provided as a string.
The creation of a simple kernel that copies all values from one texture to another could look as follows:

    var kernel = gpgl.createKernel("\
        uniform sampler2D in;\
        \
        void main() {\
            gl_FragColor = texture2D(in, global_id_norm);\
        }");

Arguments of the kernel are global variables defined by the prefix `uniform`. The type `sampler2D` declares a variable referencing an image. Besides that special vector types are available for integers (`ivec2`, `ivec3` and `ivec4`) and floats (`vec2`, `vec3` and `vec4`). Of course, the primitive types `int` and `float` can also be used. Furthermore it is possible to declare arrays using these primitive data types.

Images can be accessed using the function `texture2D(img, pos)` with the source image and normalized coordinates as arguments. The resulting value is of type `vec4` and its elements depend on the format of the input image:

 * `Format.UBYTE8888`: all four elments are valid and contain a value within the range [0; 1] (normalized 8 bit byte values)
 * `Format.FLOAT32`: only the first element is valid which contains the floating point number within the range [-2^{62}; 2^{62}]

To simplify the coordinate calculation necessary for accessing images the following variables are provided in the style of OpenCL:

 * `global_id_norm`: normalized global thread ID of type `vec2`
 * `global_id_abs`: absolute global thread ID of type `vec2`
 * `global_size`: absolute global number of threads of type `vec2`

Each thread can only write one single floating point vector of type `vec4`. This can be done by assigning this value to `gl_FragColor`.

Arguments
---------

 * `Arg.INT`
 * `Arg.FLOAT`

 * `setArgScalar(name, type, value)`
 * `setArgVector(name, type, dim, data)`
 * `setArgArray(name, type, ref)`
 * `setArgImage(name, img)`

    kernel.setArgImage("in", img);

Execution
---------

    var out = gpgl.createImage(16, 16, gpgl.Format.UBYTE8888);
    kernel.run(out);

Encoding floats
---------------

    void main() {
        float ret;
        ...
        gl_FragColor = encode_float(ret);
    }

Limitations
===========

 * precision
 * shading language
 * writing float

