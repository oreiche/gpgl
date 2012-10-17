function GPGL(canvas) {
    var gl = canvas.getContext("experimental-webgl");
    if (!gl) {
        throw "WebGL is not available";
    }

    var has_float = gl.getExtension("OES_texture_float");

    var gpgl = {
        gl: gl,
        has_float: has_float,

        IMAGE_RGBA_UBYTE: 0,
        IMAGE_L_FLOAT: 1,

        ARG_FLOAT: 0,
        ARG_INT: 1,

        createKernel: function(fragment) {
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

            gl.shaderSource(v, "attribute vec2 a_position; \
                                uniform float u_flipY; \
                                uniform vec2 global_size_abs; \
                                varying vec2 global_id_abs; \
                                varying vec2 global_id_norm; \
                                void main() { \
                                    global_id_norm = (a_position + vec2(1, 1)) / vec2(2, 2); \
                                    global_id_abs = global_size_abs * global_id_norm; \
                                    gl_Position = vec4(a_position * vec2(1, u_flipY), 0, 1); \
                                }");
            gl.shaderSource(f, "precision highp float; \
                                uniform vec2 global_size_abs; \
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
                                fragment);

            gl.compileShader(v);
            if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) {
                throw "Failed to compile vertex shader: " +
                      gl.getShaderInfoLog(v);
            }

            gl.compileShader(f);
            if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) {
                throw "Failed to compile fragment shader: " +
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
            var size = gl.getUniformLocation(program, "global_size_abs");
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

            function setArg(name, type, dim, data, isarray) {
                if (dim !== data.length) {
                    throw "Vector input data mismatch: " +
                          dim + " !== " + data.length;
                }

                var location, uniform;
                if (args[name]) {
                    location = args[name].location;
                    uniform = args[name].uniform;
                } else {
                    location = gl.getUniformLocation(program, name);
                    uniform = "uniform";
                    switch (type) {
                    case gpgl.ARG_INT:
                        uniform += "" + dim + "i";//v";
                        break;
                    case gpgl.ARG_FLOAT:
                        uniform += "" + dim + "f";//v";
                        break;
                    default:
                        throw "Unknown argument type id '" + type + "'";
                        break;
                    }

                    if (isarray) {
                        uniform += "v";
                    }
                }

                //gl[uniform](location, data);
                args[name] = {uniform: uniform, location: location, data: data, new: true};
                //gl[uniform](location, data[0], data[1], data[2], data[3]);
            }

            return {
                setArgScalar: function(name, type, value) {
                    setArg(name, type, 1, [value]);
                },

                setArgVector: function(name, type, dim, data) {
                    setArg(name, type, dim, data);
                },

                setArgArray: function(name, type, ref) {
                    setArg(name, type, 1, [ref], true);
                },

                setArgImage: function(name, tex) {
                    var id, texId = 0;
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

                    setArg(name, gpgl.ARG_INT, 1, [texId]);

                    //gl.enable(tex.type);
                    gl.activeTexture(id);
                    gl.bindTexture(tex.type, tex.id);
                },

                run: function(dest) {
                    gl.useProgram(program);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

                    if (dest) {
                        if (dest.config === gpgl.IMAGE_L_FLOAT) {
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
                    }

                    for (i in args) {
                        if (args[i].new === true) {
                            if (args[i].uniform === "uniform1fv") {
                                // FIXME: Just a temporarily chrome fix
                                gl.uniform1fv(args[i].location, args[i].data[0]);
                            } else {
                                gl[args[i].uniform](args[i].location, args[i].data[0], args[i].data[1], args[i].data[2], args[i].data[3]);
                            }
                            args[i].new = false;
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

                delete: function() {
                    gl.deleteShader(v);
                    gl.deleteShader(f);
                    gl.deleteBuffer(buffer);
                    gl.deleteProgram(program);
                }
            };
        },

        createImage2D: function(width, height, config, data, linear) {
            var values, format, type, fb, array,
                tex = gl.createTexture();

            gl.bindTexture(gl.TEXTURE_2D, tex);
            //gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, (linear ? gl.LINEAR : gl.NEAREST));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            //FIXME HANDLE IMAGE DATA
            switch (config) {
            case gpgl.IMAGE_RGBA_UBYTE:
                if (data && data.length !== width * height * 4) {
                    throw "Image input data mismatch: " +
                          data.length + " !== " + width + " * " + height + " * 4";
                }
                format = gl.RGBA;
                type = gl.UNSIGNED_BYTE;
                array = "Uint8Array";
                break;

            case gpgl.IMAGE_L_FLOAT:
                if (!has_float) {
                    throw "Float textures are not available";
                }
                if (data && data.length !== width * height) {
                    throw "Image input data mismatch: " +
                          data.length + " !== " + width + " * " + height;
                }
                format = gl.LUMINANCE;
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

            gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, values);

            fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); 

            return {
                id: tex,
                fb: fb,
                width: width,
                height: height,
                config: config,
                type: gl.TEXTURE_2D,

                readPixels: function(decode) {
                    if (this.config === gpgl.IMAGE_L_FLOAT) {
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

                delete: function() {
                    gl.deleteFramebuffer(fb);
                    gl.deleteTexture(tex);
                }
            };
        }
    };

    return gpgl;
}

