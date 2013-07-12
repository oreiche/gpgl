/**
 * Creates wrapper for general purpose computing using WebGL.
 * @class GPGL Wrapper
 * @param {HTMLCanvasElement} canvas HTML5 canvas object.
 */
function GPGL(canvas) {
    "use strict";

    /** @private */

    var gl = canvas.getContext("experimental-webgl");
    if (!gl) {
        throw "WebGL is not available";
    }

    var has_float = gl.getExtension("OES_texture_float");
    var has_float_linear = gl.getExtension("OES_float_linear");

    var gpgl = {
    /** @lends GPGL.prototype */
        /** @public */

        /**
         * WebGL Context
         * @type WebGLRenderingContext
         */
        gl: gl,

        /**
         * Indicates whether floating point textures extension is available.
         * @type Boolean
         */
        has_float: has_float,

        /**
         * Indicates whether floating point textures extension supports linear
         * filtering.
         * @type Boolean
         */
        has_float_linear: has_float_linear,

        /**
         * Enumerator for image format
         * @class Image formats
         */
        Format: {
            /**
             * Image format for four channel unsigned byte.
             * @type Enum
             */
            UBYTE8888: 0,

            /**
             * Image format for single channel floating point.
             * @type Enum
             */
            FLOAT32:   1
        },

        /**
         * Enumerator for kernel argument type.
         * @class Kernel argument types
         */
        Arg: {
            /**
             * Kernel argument type floating point.
             * @type Enum
             */
            FLOAT: 0,

            /**
             * Kernel argument type integer.
             * @type Enum
             */
            INT:   1,
        },

        /**
         * Creates kernel function.
         * @param {String} source Source code of kernel function.
         * @returns {GPGL.Kernel}
         */
        createKernel: function(source) {
            /** @private */

            var texIds = {
                list: [],
                dict: {}
            }

            var program = gl.createProgram();
            this.program = program;

            var buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER,
                          new Float32Array([-1, -1,
                                             1, -1,
                                            -1,  1,
                                            -1,  1,
                                             1, -1,
                                             1,  1]),
                          gl.STATIC_DRAW);

            var v = gl.createShader(gl.VERTEX_SHADER),
                f = gl.createShader(gl.FRAGMENT_SHADER);

            gl.shaderSource(v, "precision highp float; \
                                attribute vec2 a_position; \
                                uniform float u_flipY; \
                                uniform vec2 global_size; \
                                varying vec2 global_id_abs; \
                                varying vec2 global_id_norm; \
                                void main() { \
                                    global_id_norm = a_position * 0.5 + 0.5; \
                                    global_id_abs = global_size * global_id_norm; \
                                    gl_Position = vec4(a_position * vec2(1, u_flipY), 1.0, 1.0); \
                                }");
            gl.shaderSource(f, "#ifdef GL_FRAGMENT_PRECISION_HIGH \n\
                                precision highp float; \n\
                                #else \n\
                                precision mediump float; \n\
                                #endif \n\
                                uniform vec2 global_size; \
                                varying vec2 global_id_abs; \
                                varying vec2 global_id_norm; \
                                float shift_right(float v, float amt) {\
                                  v = floor(v) + 0.5;\
                                  return floor(v / exp2(amt));\
                                }\
                                float shift_left(float v, float amt) {\
                                  return floor(v * exp2(amt) + 0.5);\
                                }\
                                \
                                float mask_last(float v, float bits) {\
                                  return mod(v, shift_left(1.0, bits));\
                                }\
                                float extract_bits(float num, float from, float to) {\
                                  from = floor(from + 0.5);\
                                  to = floor(to + 0.5);\
                                  return mask_last(shift_right(num, from), to - from);\
                                }\
                                vec4 encode_float(float val) {\
                                  if (val == 0.0)\
                                    return vec4(0, 0, 0, 0);\
                                  float sign = val > 0.0 ? 0.0 : 1.0;\
                                  val = abs(val);\
                                  float exponent = floor(log2(val));\
                                  float biased_exponent = exponent + 127.0;\
                                  float fraction = ((val / exp2(exponent)) - 1.0) * 8388608.0;\
                                  \
                                  float t = biased_exponent / 2.0;\
                                  float last_bit_of_biased_exponent = fract(t) * 2.0;\
                                  float remaining_bits_of_biased_exponent = floor(t);\
                                  \
                                  float byte4 = extract_bits(fraction, 0.0, 8.0) / 255.0;\
                                  float byte3 = extract_bits(fraction, 8.0, 16.0) / 255.0;\
                                  float byte2 = (last_bit_of_biased_exponent * 128.0 + extract_bits(fraction, 16.0, 23.0)) / 255.0;\
                                  float byte1 = (sign * 128.0 + remaining_bits_of_biased_exponent) / 255.0;\
                                  return vec4(byte4, byte3, byte2, byte1);\
                                }" +
                                source);

            gl.compileShader(v);
            if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) {
                throw "Failed to compile vertex shader: " +
                      gl.getShaderInfoLog(v);
            }

            gl.compileShader(f);
            if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) {
                throw "Failed to compile kernel source: " +
                      gl.getShaderInfoLog(f);
            }

            gl.attachShader(program, v);
            gl.attachShader(program, f);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw "Failed to link program";
            }

            var position = gl.getAttribLocation(program, "a_position");
            var flip = gl.getUniformLocation(program, "u_flipY");
            var size = gl.getUniformLocation(program, "global_size");
            var vp = gl.getParameter(gl.VIEWPORT);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            var Target = {
                None:    0,
                Canvas:  1,
                Texture: 2
            };

            var renderTarget = Target.None;

            var args = {};

            function setArg(name, type, data, info) {
                var location, uniform,
                    dim = data.length;

                if (args[name]) {
                    location = args[name].location;
                    uniform = args[name].uniform;
                } else {
                    location = gl.getUniformLocation(program, name);
                    uniform = "uniform";
                    switch (type) {
                    case gpgl.Arg.INT:
                        uniform += "" + dim + "i";
                        break;
                    case gpgl.Arg.FLOAT:
                        uniform += "" + dim + "f";
                        break;
                    default:
                        throw "Unknown argument type id '" + type + "'";
                        break;
                    }

                    if (info !== undefined && info.isarray === true) {
                        uniform += "v";
                    }
                }

                if (info === undefined || info.isimage !== true) {
                    args[name] = {uniform: uniform, location: location, data: data, new: true};
                } else {
                    args[name] = {uniform: uniform, location: location, data: data, new: true,
                                  id: info.id, tex: info.tex, type: info.type};
                }
            }

            /** @lends GPGL.Kernel.prototype */
            return {
                /** @public */

                /**
                 * Set scalar kernel argument.
                 * @param {String}   name  Name of the kernel uniform to map the value to.
                 * @param {GPGL#Arg} type  Type of the kernel uniform.
                 * @param {Number}   value Value to store in the kernel uniform.
                 */
                setArgScalar: function(name, type, value) {
                    if (value === undefined) {
                        throw "Scalar argument value is undefined: " + name;
                    }
                    setArg(name, type, [value]);
                },

                /**
                 * Set vector kernel argument.
                 * @param {String}   name Name of the kernel uniform to map the values to.
                 * @param {GPGL#Arg} type Type of the kernel uniform values.
                 * @param {Array}    data Data array containing the values to store.
                 */
                setArgVector: function(name, type, data) {
                    if (data === undefined) {
                        throw "Vector argument is undefined: " + name;
                    } else if (data.length === undefined ||
                               data.length === 0 ||
                               data.length > 4) {
                        throw "Wrong dimension for vector '" +
                              name + "': " + data.length;
                    }

                    setArg(name, type, data);
                },

                /**
                 * Set array kernel argument.
                 * @param {String}   name Name of the kernel uniform to map the array to.
                 * @param {GPGL#Arg} type Type of the kernel uniform array.
                 * @param {Array}    ref  Reference of the array to set.
                 */
                setArgArray: function(name, type, ref) {
                    if (ref === undefined) {
                        throw "Array argument is undefined: " + name;
                    } else if (ref.length === undefined) {
                        throw "Array argument is no array: " + name;
                    }
                    setArg(name, type, [ref], {isarray: true});
                },

                /**
                 * Set image kernel argument.
                 * @param {String}       name Name of the kernel sampler2D to map the image to.
                 * @param {GPGL.Texture} tex  Texture object to set.
                 */
                setArgImage: function(name, tex) {
                    var id, texId = 0;

                    if (tex === undefined) {
                        throw "Image argument is undefined: " + name;
                    } else if (tex.type !== gl.TEXTURE_2D ||
                               tex.id === undefined ||
                               tex.id === null) {
                        throw "Image argumetn is no image: " + name;
                    }

                    if (texIds.dict[name] === undefined) {
                        while (texIds.list[texId]) {
                            ++texId;
                        }
                        texIds.dict[name] = texId;
                        texIds.list[texId] = name;
                    } else {
                        texId = texIds.dict[name];
                    }

                    id = gl["TEXTURE" + texId];
                    if (id === undefined) {
                        throw "To many textures bound to this kernel: " + texId;
                    }

                    setArg(name, gpgl.Arg.INT, [texId],
                           {isimage: true, id: id, tex: tex.id, type: tex.type});
                },

                /**
                 * Execute kernel function.
                 * @param {GPGL.Texture} dest (OPTIONAL) Target texture to render to. The kernel
                 *                            renders to bound HTMLCanvasElement if target is not
                 *                            defined.
                 */
                run: function(dest) {
                    gl.useProgram(program);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

                    if (dest) {
                        if (dest.format === gpgl.Format.FLOAT32) {
                            throw "Rendering to float textures not supported yet";
                        }

                        if (renderTarget !== Target.Texture) {
                            gl.uniform1f(flip, 1);
                            renderTarget = Target.Texture;
                        }
                        gl.uniform2f(size, dest.width, dest.height);
                        gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fb);
                        gl.viewport(0, 0, dest.width, dest.height);
                    } else {
                        if (renderTarget !== Target.Canvas) {
                            gl.uniform1f(flip, -1.0);
                            gl.uniform2f(size, vp[2], vp[3]);
                            renderTarget = Target.Canvas;
                        }
                        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                        gl.viewport(0, 0, canvas.width, canvas.height);
                    }

                    for (var i in args) {
                        if (args[i].new === true) {
                            if (args[i].uniform === "uniform1fv") {
                                // FIXME: Just a temporarily chrome fix
                                gl.uniform1fv(args[i].location, args[i].data[0]);
                            } else {
                                gl[args[i].uniform](args[i].location, args[i].data[0], args[i].data[1], args[i].data[2], args[i].data[3]);
                            }
                            args[i].new = false;
                        }
                        if (args[i].id !== undefined) {
                            // It's a texture, refresh binding
                            gl.activeTexture(args[i].id);
                            gl.bindTexture(args[i].type, args[i].tex);
                        }
                    }

                    // draw
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                    gl.finish();

                    if (renderTarget === Target.Texture) {
                        // restore viewport
                        gl.viewport(vp[0], vp[1], vp[2], vp[3]);
                    }
                },

                /**
                 * Deletes all internally created WebGL handles.
                 */
                delete: function() {
                    gl.deleteShader(v);
                    gl.deleteShader(f);
                    gl.deleteBuffer(buffer);
                    gl.deleteProgram(program);
                }
            };
        },

        /**
         * Creates two dimensional image object (texture).
         * @param {Number}      width  Width of image element.
         * @param {Number}      height Height of image element.
         * @param {GPGL#Format} format Pixel format used for image.
         * @param {Array}       data   (OPTIONAL) Initial data for image.
         * @param {Boolean}     linear (OPTIONAL) Enable bilinear filtering.
         * @returns {GPGL.Image2D}
         */
        createImage2D: function(width, height, format, data, linear) {
            /** @private */

            var values, chan, type, fb, array,
                tex = gl.createTexture();

            //FIXME HANDLE IMAGE DATA
            switch (format) {
            case gpgl.Format.UBYTE8888:
                if (data && data.length !== width * height * 4) {
                    throw "Image input data mismatch: " +
                          data.length + " !== " + width + " * " + height + " * 4";
                }
                chan = gl.RGBA;
                type = gl.UNSIGNED_BYTE;
                array = "Uint8Array";
                break;

            case gpgl.Format.FLOAT32:
                if (!has_float) {
                    throw "Float textures are not available";
                } 
                if (!has_float_linear && linear) {
                    // However, this works with Chrome (<=28) and Firefox (<=22)
                    // even though the extension is not available. Therefore,
                    // no error will be thrown.
                    if (console && console.warn) {
                        console.warn("Linear filtering of float textures is "
                                     + "not available");
                    }
                }
                if (data && data.length !== width * height) {
                    throw "Image input data mismatch: " +
                          data.length + " !== " + width + " * " + height;
                }
                chan = gl.LUMINANCE;
                type = gl.FLOAT;
                array = "Float32Array";
                break;
            }

            if (data !== undefined && data !== null) {
                values = new window[array](data.length);
                for (var i = 0; i < data.length; ++i) {
                    values[i] = data[i];
                }
            } else {
                values = null;
            }

            gl.bindTexture(gl.TEXTURE_2D, tex);
            //gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, (linear ? gl.LINEAR : gl.NEAREST));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, (linear ? gl.LINEAR : gl.NEAREST));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            gl.texImage2D(gl.TEXTURE_2D, 0, chan, width, height, 0, chan, type, values);

            fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); 

            /** @lends GPGL.Image2D.prototype */
            return {
                /** @public */

                /**
                 * Texture handle.
                 * @type WebGLTexture
                 */
                id: tex,

                /**
                 * Framebuffer handle.
                 * @type WebGLFramebuffer
                 */
                fb: fb,
                
                /**
                 * Image width.
                 * @type Number
                 */
                width: width,

                /**
                 * Image height.
                 * @type Number
                 */
                height: height,

                /**
                 * Image format.
                 * @type GPGL#Format
                 */
                format: format,
                
                /**
                 * Image WebGL texture type.
                 * @type Enum
                 */
                type: gl.TEXTURE_2D,

                /**
                 * Read pixels from image.
                 * @param {Boolean} decode (OPTIONAL) Decode pixels to floating point array.
                 * @returns {UInt8Array|Float32Array} Containing the pixel data.
                 */
                readPixels: function(decode) {
                    if (this.format === gpgl.Format.FLOAT32) {
                        throw "Reading from float textures not supported yet";
                    }

                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
                    var pixels = new Uint8Array(this.width * this.height * 4);
                    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                    if (decode) {
                        pixels = new Float32Array(pixels.buffer);
                    }

                    return pixels;
                },

                /**
                 * Deletes internally created WebGL handles.
                 */
                delete: function() {
                    gl.deleteFramebuffer(fb);
                    gl.deleteTexture(tex);
                }
            };
        }
    };

    return gpgl;
}

// Declare anonymous classes for JsDoc.
// Necessary for proper Documentation of Types created by Factories.
/** @class GPGL Kernel */
GPGL.Kernel = {};
/** @class GPGL Image2D */
GPGL.Image2D = {};

