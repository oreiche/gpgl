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

Creation and Reading
--------------------

To create a new image the function `createImage2D(width, height, format [, data] [, linear])` can be used:

    var ary = [...]; // Size: 1024
    var img = gpgl.createImage2D(16, 16, gpgl.Format.UBYTE8888, ary);

The creation function for images accepts arrays of the type `Array`, `UInt8Array` and `Float32Array` as initial data.

To obtain the data from device memory use the method `readPixels([decode])`. The flag `decode` triggers the decoding of previously encoded float values (see below). However, it is not necessary to simply obtain RGBA values from an image:

    var data = img.readPixels();

Image Formats
-------------

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

Kernels can be created using the function `createKernel(source)`.
The kernel source code must be provided as a string.
The creation of a simple kernel that copies all values from one texture to another could look as follows:

    var kernel = gpgl.createKernel(" \
        uniform sampler2D in; \
        \
        void main() { \
            gl_FragColor = texture2D(in, global_id_norm); \
        }");

Arguments of the kernel are global variables defined by the prefix `uniform`. The type `sampler2D` declares a variable referencing an image. Besides that special vector types are available for integers (`ivec2`, `ivec3` and `ivec4`) and floats (`vec2`, `vec3` and `vec4`). Of course, the primitive types `int` and `float` can also be used. Furthermore it is possible to declare arrays using these primitive data types.

Images can be accessed using the function `texture2D(img, pos)` with the source image and normalized coordinates as arguments. The resulting value is of type `vec4` and its elements depend on the format of the input image:

 * `Format.UBYTE8888`: all four elements are valid and contain a value within the range [0; 1] (normalized 8 bit byte values)
 * `Format.FLOAT32`: only the first element is valid which contains the floating point number within the range [-2^{62}; 2^{62}]

To simplify the coordinate calculation necessary for accessing images the following variables are provided in the style of OpenCL:

 * `global_id_norm`: normalized global thread ID of type `vec2`
 * `global_id_abs`: absolute global thread ID of type `vec2`
 * `global_size`: absolute global number of threads of type `vec2`

Each thread can only write one single floating point vector of type `vec4`. This can be done by assigning this value to `gl_FragColor`.

Arguments
---------

Kernel arguments can be set by using the following methods:

 * `setArgScalar(name, type, value)`
 * `setArgVector(name, type, dim, data)`
 * `setArgArray(name, type, ref)`
 * `setArgImage(name, img)`

Depending on whether the data type is scalar, vector, array or image type a different method with different parameters needs to be used. However, all have the first parameter in common, which is the name of the variable to map the kernel argument to. For scalar, vectors and arrays the second parameter defines the primitive type used. The two primitive types that are supported as kernel arguments are:

 * `Arg.INT`
 * `Arg.FLOAT`

To set the input image for the example kernel source (see above) use the following method call:

    kernel.setArgImage("in", img);

Execution
---------

Kernels can be executed using the method `run([output])`. The optional output parameter defines the target image for rendering and therefore describes the iteration space for kernel threads. The following code shows an possible kernel execution.

    var out = gpgl.createImage(16, 16, gpgl.Format.UBYTE8888);
    kernel.run(out);

If no output image is defined the default canvas is used for rendering. The default canvas is the HTMLCanvas element that was bound to the GPGL wrapper during its initialization.

Encoding floats
---------------

Writing to floating point textures is not supported by WebGL. Therefore it is necessary to work around this issue by encoding float values in a way that they can be stored in an image of the type `UBYTE888`. This can be easily done by using the built-in kernel function `encode_float([value])`:

    void main() {
        float val;
        ...
        gl_FragColor = encode_float(val);
    }

The source code for encoding and more detailed information about this issue can be found on http://concord-consortium.github.com/lab/experiments/webgl-gpgpu/webgl.html

Example Code (Blur)
===================

The following example code sums up the values within a 3x3 window and stores the averaged value:

    // Instantiate general purpose GL wrapper
    try {
        gpgl = new GPGL(canvas);
    } catch (err) {
        alert("Your browser does not support WebGL");
    }

    // Create kernel for blur
    kernel = gpgl.createKernel("\
        uniform sampler2D img;\
        \
        void main() {\
            vec2 step = vec2(1.0, 1.0) / global_size;\
            gl_FragColor = (texture2D(img, global_id_norm - step) +\
                            texture2D(img, global_id_norm - vec2(0, step.y)) +\
                            texture2D(img, global_id_norm - vec2(-step.x, step.y)) +\
                            texture2D(img, global_id_norm - vec2(step.x, 0)) +\
                            texture2D(img, global_id_norm) +\
                            texture2D(img, global_id_norm + vec2(step.x, 0)) +\
                            texture2D(img, global_id_norm + vec2(-step.x, step.y)) +\
                            texture2D(img, global_id_norm + vec2(0, step.y)) +\
                            texture2D(img, global_id_norm + step)) / 9.0;\
        }");

    // Copy image data from host memory to device memory
    var image = gpgl.createImage2D(width, height, gpgl.Format.UBYTE8888, imageData.data);

    // Set kernel parameter
    kernel.setArgImage("img", image);

    // Run kernel and render to bound canvas
    kernel.run();

    // Cleanup
    kernel.delete();
    image.delete();

To see the full code and other examples have a look at the `example` directory in the sources.

Limitations
===========

 * less precision
 * limited shading language
 * overhead for writing float images

