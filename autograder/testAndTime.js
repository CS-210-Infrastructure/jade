const utils = require('./utils');
const gatesim = require('./gatesim');
const fs = require('fs');
const { exit } = require('process');

function do_express_test() {
    var test,netlist;
    if (process.argv[2] === undefined || process.argv[3] === undefined) {
        console.log('USAGE: node tester.js <test_file> <netlist_file> <benchmarkTime');
        console.log(' benchmarkTime only required for optional timing analysis.');
        exit(1);
    } else {
        console.log('INFO: Running express test...');
        console.log('INFO: Test File: '+process.argv[2]);
        console.log('INFO: Netlist File: '+process.argv[3]);
        try {
            test = fs.readFileSync(process.argv[2], 'utf8').replace(/\\\\/g, '\\');
            netlist = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
            if (process.argv[4] !== undefined) {
                benchmarkTime = parseFloat(process.argv[4]);
                console.log('INFO: Timing Analysis Enabled - Benchmark Time: '+process.argv[4]);
            } else {
                benchmarkTime = -1;
            }
        } catch (e) {
            console.log('ERROR: '+e);
            exit(1);
        }
    }
    //var test2 = ".power Vdd=1\n.thresholds Vol=0 Vil=0.1 Vih=0.9 Voh=1\n\n.group inputs A B\n.group outputs Y\n\n.mode gate\n\n.cycle assert inputs tran 99n sample outputs tran 1n\n\n1 1 L\n\n      \n.plot X(A)\n.plot X(B)\n.plot X(Y)"
    //var netlist2 = [{"type":"nand2","connections":{"z":"y","b":"b","a":"a"},"properties":{"name":"nand2_1","tcd":1e-11,"tpd":3e-11,"tr":4500,"tf":2800,"cin":4e-15,"size":10}}];
    try {
        express_test(test,netlist,benchmarkTime);
        
    } catch (e) {
        console.log('Error: '+e);
    }
    return;
}

function express_test(source,netlist,benchmarkTime) {
    var test_result = 'Error detected: test did not yield a result.';
    var msg;

    // remove multiline comments, in-line comments
    source = source.replace(/\/\*(.|\n)*?\*\//g,'');   // multi-line using slash-star
    source = source.replace(/\/\/.*/g,'');  // single-line comment

    var i,j,k,v;
    var repeat = 1;
    var mode = 'gate';  // which simulation to run
    var plots = [];     // list of signals to plot
    var tests = [];     // list of test lines
    var mverify = {};   // mem name -> [value... ]
    var mverify_src = [];   // list of .mverify source lines (used for checksum)
    var power = {};     // node name -> voltage
    var thresholds = {};  // spec name -> voltage
    var cycle = [];    // list of test actions: [action args...]
    var groups = {};   // group name -> list of indicies
    var signals = [];  // list if signals in order that they'll appear on test line
    var driven_signals = {};   // if name in dictionary it will need a driver ckt
    var sampled_signals = {};   // if name in dictionary we want its value
    var plotdefs = {};   // name -> array of string representations for values
    var errors = [];
    var log_signals = [];  // signals to report in each log entry

    // process each line in test specification
    source = source.split('\n');
    for (k = 0; k < source.length; k += 1) {
        var line = source[k].match(/([A-Za-z0-9_.:\[\]]+|=|-|,|\(|\))/g);
        if (line === null) continue;
        if (line[0] == '.mode') {
            if (line.length != 2) errors.push('Malformed .mode statement: '+source[k]);
            else if (line[1] == 'device' || line[1] == 'gate') mode = line[1]
            else errors.push('Unrecognized simulation mode: '+line[1]);
        }
        else if (line[0] == '.power' || line[0] == '.thresholds') {
            // .power/.thresholds name=float name=float ...
            for (i = 1; i < line.length; i += 3) {
                if (i + 2 >= line.length || line[i+1] != '=') {
                    errors.push('Malformed '+line[0]+' statement: '+source[k]);
                    break;
                }
                v = utils.parse_number(line[i+2]);
                if (isNaN(v)) {
                    errors.push('Unrecognized voltage specification "'+line[i+2]+'": '+source[k]);
                    break;
                }
                if (line[0] == '.power') power[line[i].toLowerCase()] = v;
                else thresholds[line[i]] = v;
            }
        }
        else if (line[0] == '.group') {
            // .group group_name name...
            if (line.length < 3) {
                errors.push('Malformed .group statement: '+source[k]);
            } else {
                // each group has an associated list of signal indicies
                groups[line[1]] = [];
                for (j = 2; j < line.length; j += 1) {
                    utils.parse_signal(line[j]).forEach(function (sig,index) {
                        // remember index of this signal in the signals list
                        groups[line[1]].push(signals.length);
                        // keep track of signal names
                        signals.push(sig);
                    });
                }
            }
        }
        else if (line[0] == '.plotdef') {
            // We are not plotting in express testing.
        }
        else if (line[0] == '.plot') {
            // We are not plotting in express testing.
        }
        else if (line[0] == '.cycle') {
            // .cycle actions...
            //   assert <group_name>
            //   deassert <group_name>
            //   sample <group_name>
            //   tran <duration>
            //   log
            //   <name> = <voltage>
            if (cycle.length != 0) {
                errors.push('More than one .cycle statement: '+source[k]);
                break;
            }
            i = 1;
            while (i < line.length) {
                if ((line[i] == 'assert' || line[i] == 'deassert' || line[i] == 'sample') && i + 1 < line.length) {
                    var glist = groups[line[i+1]];
                    if (glist === undefined) {
                        errors.push('Use of undeclared group name "'+line[i+1]+'" in .cycle: '+source[k]);
                        break;
                    }
                    // keep track of which signals are driven and sampled
                    for (j = 0; j < glist.length; j += 1) {
                        if (line[i] == 'assert' || line[i] == 'deassert')
                            driven_signals[signals[glist[j]]] = [[0,'Z']]; // driven node is 0 at t=0
                        if (line[i] == 'sample')
                            sampled_signals[signals[glist[j]]] = []; // list of tvpairs
                    }
                    cycle.push([line[i],line[i+1]]);
                    i += 2;
                    continue;
                }
                else if (line[i] == 'tran' && (i + 1 < line.length)) {
                    v = utils.parse_number(line[i+1]);
                    if (isNaN(v)) {
                        errors.push('Unrecognized tran duration "'+line[i+1]+'": '+source[k]);
                        break;
                    }
                    cycle.push(['tran',v]);
                    i += 2;
                    continue;
                }
                else if (line[i] == 'log') {
                    cycle.push(['log']);
                    i += 1;
                    continue;
                }
                else if (line[i+1] == '=' && (i + 2 < line.length)) {
                    v = line[i+2];   // expect 0,1,Z
                    if ("01Z".indexOf(v) == -1) {
                        errors.push('Unrecognized value specification "'+line[i+2]+'": '+source[k]);
                        break;
                    }
                    cycle.push(['set',line[i].toLowerCase(),v]);
                    driven_signals[line[i].toLowerCase()] = [[0,'Z']];  // driven node is 0 at t=0
                    i += 3;
                    continue;
                }
                errors.push('Malformed .cycle action "'+line[i]+'": '+source[k]);
                break;
            }
        }
        else if (line[0] == '.repeat') {
            repeat = parseInt(line[1]);
            if (isNaN(repeat) || repeat < 1) {
                errors.push('Expected positive integer for .repeat: '+line[1]);
                repeat = 1;
            }
        }
        else if (line[0] == '.log') {
            // capture signal names for later printout
            for (j = 1; j < line.length; j += 1) {
                utils.parse_signal(line[j]).forEach(function (sig,index) {
                    log_signals.push(sig);
                });
            }
        }
        else if (line[0] == '.mverify') {
            // .mverify mem_name locn value...
            if (line.length < 4)
                errors.push("Malformed .mverify statement: "+source[k]);
            else {
                var locn = parseInt(line[2]);
                if (isNaN(locn)) {
                    errors.push('Bad location "'+line[2]+'" in .mverify statement: '+source[k]);
                } else {
                    var a = mverify[line[1].toLowerCase()];
                    if (a === undefined) {
                        a = [];
                        mverify[line[1].toLowerCase()] = a;
                    }
                    for (j = 3; j < line.length; j += 1) {
                        v = parseInt(line[j]);
                        if (isNaN(v)) {
                            errors.push('Bad value "'+line[j]+'" in .mverify statement: '+source[k]);
                        } else {
                            // save value in correct location in array
                            // associated with mem_name
                            a[locn] = v;
                            locn += 1;
                        }
                    }
                    mverify_src.push(source[k]);  // remember source line for checksum
                }
            }
        }
        else if (line[0][0] == '.') {
            errors.push('Unrecognized control statment: '+source[k]);
        }
        else {
            var test = line.join('');
            // each test should specify values for each signal in each group
            if (test.length != signals.length) {
                errors.push('Test line does not specify '+signals.length+' signals: '+source[k]);
                break;
            }
            // check for legal test values
            for (j = 0; j < test.length; j += 1) {
                if ("01ZLH-".indexOf(test[j]) == -1) {
                    errors.push('Illegal test value '+test[j]+': '+source[k]+' (must be one of 01ZLH-)');
                    break;
                }
            }
            // repeat the test the request number of times, leave repeat at 1
            while (repeat--) tests.push(test);
            repeat = 1;
        }
    };

    // check for necessary threshold specs
    if (!('Vol' in thresholds)) errors.push('Missing Vol threshold specification');
    if (!('Vil' in thresholds)) errors.push('Missing Vil threshold specification');
    if (!('Vih' in thresholds)) errors.push('Missing Vih threshold specification');
    if (!('Voh' in thresholds)) errors.push('Missing Voh threshold specification');

    if (cycle.length == 0) errors.push('Missing .cycle specification');
    if (tests.length == 0) errors.push('No tests specified!');

    if (errors.length != 0) {
        msg = errors.join('\n');
        test_result = 'Error detected: '+msg;
        console.log('ERROR: '+test_result);
        process.exitCode = 1;
        return;
    }

    //console.log('power: '+JSON.stringify(power));
    //console.log('thresholds: '+JSON.stringify(thresholds));
    //console.log('groups: '+JSON.stringify(groups));
    //console.log('cycle: '+JSON.stringify(cycle));
    //console.log('tests: '+JSON.stringify(tests));

    var nodes = utils.extract_nodes(netlist);  // get list of nodes in netlist
    function check_node(node) {
        if (!(node in driven_signals) && nodes.indexOf(node) == -1)
            errors.push('There are no devices connected to node "'+node+'".');
    }
    Object.keys(driven_signals).forEach((node,idx) => check_node(node));
    Object.keys(sampled_signals).forEach((node,idx) => check_node(node));
    Object.keys(log_signals).forEach(function(key,idx) {var n = log_signals[key]; check_node(n);});

    if (errors.length != 0) {
        msg = errors.join('\n');
        test_result = 'Error detected: '+msg;
        console.log('ERROR: '+test_result);
        process.exitCode = 1;
        return;
    }

    // ensure simulator knows what gnd is
    netlist.push({type: 'ground',connections:['gnd'],properties:{}});

    // add voltage sources for power supplies
    Object.entries(power).forEach(function([node,v]) {
        netlist.push({type:'voltage source',
                      connections:{nplus:node, nminus:'gnd'},
                      properties:{value:{type:'dc', args:[v]}, name:node/*+'_source'*/}});
    });

    // go through each test determining transition times for each driven node, adding
    // [t,v] pairs to driven_nodes dict.  v = '0','1','Z'
    var time = 0;
    function set_voltage(tvlist,v) {
        if (v != tvlist[tvlist.length - 1][1]) tvlist.push([time,v]);
    }
    var log_times = [];          // times at which to create log entry
    tests.forEach(function(test,tindex) {
        cycle.forEach(function(action,index) {
            if (action[0] == 'assert' || action[0] == 'deassert') {
                Object.keys(groups[action[1]]).forEach(function(sindex,index) {
                    if (action[0] == 'deassert' || "01Z".indexOf(test[sindex]) != -1)
                        set_voltage(driven_signals[signals[sindex]],
                                    action[0] == 'deassert' ? 'Z' : test[sindex]);
                });
            }
            else if (action[0] == 'sample') {
                groups[action[1]].forEach(function(sindex,index) {
                    if ("HL".indexOf(test[sindex]) != -1)
                        sampled_signals[signals[sindex]].push({t: time,v: test[sindex],i: tindex+1});
                });
            }
            else if (action[0] == 'set') {
                set_voltage(driven_signals[action[1]],action[2]);
            }
            else if (action[0] == 'log') {
                log_times.push(time);
            }
            else if (action[0] == 'tran') {
                time += action[1];
            }
        });
    });

    if (mode == 'device') {
        // How did we get here if we don't support device simulation?
        console.log('ERROR: Express Test does not currently support device simulation.');
        throw 'Express Test does not currently support device simulation.';
    } else if (mode == 'gate')
        build_inputs_gate(netlist,driven_signals,thresholds);
    else throw 'Unrecognized simulation mode: '+mode;
    //console.log('stop time: '+time);
    //jade.netlist.print_netlist(netlist);

    // verify results against values specified by test
    function verify_results(results) {
        // order test by time
        var tests = [];
        Object.entries(sampled_signals).forEach(function([node,tvlist]) {
            Object.values(tvlist).forEach(function(tvpair,index) {
                tests.push({n: node, t: tvpair.t, v: tvpair.v, i: tvpair.i});
            });
        });
        tests.sort(function(t1,t2) {
            // sort by time, then by name
            if (t1.t == t2.t) {
                if (t1.n < t2.n) return -1;
                else if (t1.n > t2.n) return 1;
                else return 0;
            } else return t1.t - t2.t;
        });

        // check the sampled node values for each test cycle
        var hcache = {};  // cache histories we retrieve
        var errors = [];
        var t_error;
        var v,test,history;
        for (var i = 0; i < tests.length; i += 1) {
            test = tests[i];

            // if we've detected errors at an earlier test, we're done
            // -- basically just report all the errors for the first failing test
            if (t_error && t_error < test.i) break;

            // retrieve history for this node
            history = hcache[test.n];
            if (history === undefined) {
                history = results._network_.history(test.n);
                hcache[test.n] = history;
            }

            // check observed value vs. expected value
            if (mode == 'device') {
                // How did we get here if we don't support device simulation?
                console.log('ERROR: Express Test does not currently support device simulation.');
                throw 'Express Test does not currently support device simulation.';
            }
            else if (mode == 'gate') {
                v = history === undefined ? undefined : gatesim.interpolate(test.t, history.xvalues, history.yvalues);
                if (v === undefined ||
                    (test.v == 'L' && v != 0) ||
                    (test.v == 'H' && v != 1)) {
                    errors.push('Test '+test.i.toString()+': Expected '+test.n+'='+test.v+
                                ' at '+utils.engineering_notation(test.t,2)+'s.');
                    t_error = test.i;
                }
            }
            else throw 'Unrecognized simulation mode: '+mode;
        }

        // perform requested memory verifications
        Object.keys(mverify).forEach(function (a,mem_name) {
            var mem = results._network_.device_map[mem_name];
            if (mem === undefined) {
                errors.push('Cannot find memory named "'+mem_name+'", verification aborted.');
                return;
            }
            mem = mem.get_contents();
            Object.keys(a).forEach(function (v,locn) {
                if (v === undefined) return;  // no check for this location
                if (locn < 0 || locn >= mem.nlocations) {
                    errors.push("Location "+locn.toString()+" out of range for memory "+mem_name);
                }
                if (mem[locn] !== v) {
                    var got = mem[locn] === undefined ? 'undefined' : '0x'+mem[locn].toString(16);
                    errors.push(mem_name+"[0x"+locn.toString(16)+"]: Expected 0x"+v.toString(16)+", got "+got);
                }
            });
        });

        // create log if requested
        // TODO: Convert log signals to be compatible with express testing.
        var log = [];
        log_times.forEach(function (t,tindex) {
            var values = [];
            log_signals.forEach(function (n,sindex) {
                // retrieve history for this node
                var history = hcache[n];
                if (history === undefined) {
                    history = results._network_.history(n);
                    hcache[n] = history;
                }
                if (history === undefined) v = '?';
                else {
                    v = jade.gate_level.interpolate(t, history.xvalues, history.yvalues);
                    v = "01XZ"[v];
                }
                values.push(v);
            });
            log.push(values.join(''));
        });
        if (log.length > 0) console.log(log.join('\n'));

        errors.t_error = t_error;   // save t_error for later use
        return errors;
    }

    function report_errors(results,errors) {
        var t_error = errors.t_error;

        // report any mismatches
        if (errors.length > 0) {
            var postscript = '';
            if (errors.length > 5) {
                errors = errors.slice(0,5);
                postscript = '<br>...';
            }

            msg = '';
            msg += errors.join('\n')+postscript;
            test_result = 'Error detected: '+msg;
            process.exitCode = 1;
        } else {
            // Benmark = 1e-10/(size_in_m**2 * simulation_time_in_s)
            var benmark = 1e-10/((results._network_.size*1e-12) * results._network_.time);
            if (benchmarkTime == -1) {
                test_result = 'passed '+ +benmark.toString();
                return;
            } else {
                console.log("INFO: Accuracy Test Complete. Checking Timing Analysis...");
                
                // Before giving a pass, we need to check if the largest TPD is less than the benchmark time.
                try {
                    // Resettting the netlist after changes from testing.
                    let result = timing_analysis(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')),{},10,benchmarkTime);
                    if (result == -1) {
                        test_result = 'ERROR: Largest TPD is greater than benchmark time.';
                        process.exitCode = 1;
                        return;
                    } else {
                        console.log('INFO: Timing Analysis Complete.');
                    }
                } catch (e) {
                    console.log('ERROR: '+e);
                    process.exitCode = 1;
                    return;
                }

                test_result = 'passed '+ +benmark.toString();
                // Exit code is 0 by default.
            }
        }
    }

    // handle results from the simulation
    function process_results(percent_complete,results) {
        if (percent_complete === undefined) {
            if (typeof results == 'string') {
                test_result = 'Error detected: '+results;
                process.exitCode = 1;
            } else if (results instanceof Error) {
                results = results.stack.split('\n').join('<br>');
                test_result = 'Error detected: '+results.message;
                process.exitCode = 1;
            } else {
                // process results after giving UI a chance to update
                var errors = verify_results(results);
                report_errors(results,errors);
            }
            console.log('RESULT: '+test_result);

            return undefined;
        }
    }

    // do the simulation
    try {
        if (mode == 'device') {
            // Device simulation not currently supported in express mode.
            console.log('ERROR: Express Test does not currently support device simulation.')
            throw 'Express Test does not currently support device simulation.';
        } else if (mode == 'gate') {
            gatesim.transient_analysis(netlist, time, Object.keys(sampled_signals), process_results, {});
            console.log('INFO: Express Test Complete.');
        } else 
            throw 'Unrecognized simulation mode: '+mode;
    } catch (e) {
        test_result = 'Error detected running simulation: '+e;
        console.log('ERROR: '+test_result);
        console.log('INFO: Express Test Finished with Errors.');
        process.exitCode = 1;
        setTimeout(function() {}, 1000);
        return;
    }
};

// add netlist elements to drive input nodes
// for gate simulation, each input node is connected to a tristate driver
// with the input and enable waveforms chosen to produce 0, 1 or Z
function build_inputs_gate(netlist,driven_signals,thresholds) {
    // add tristate drivers for driven nodes
    Object.keys(driven_signals).forEach(function(node) {
        netlist.push({type:'tristate',
                      connections:{e:node+'_enable', a:node+'_data', z:node},
                      properties:{name: node+'_input_driver', tcd: 0, tpd: 100e-12, tr: 0, tf: 0, cin:0, size:0}});
    });


    // construct PWL voltage sources to control data and enable inputs for driven nodes
    Object.entries(driven_signals).forEach(function([node,tvlist]) {
        var e_pwl = [0,thresholds.Vol];   // initial <t,v> for enable (off)
        var a_pwl = [0,thresholds.Vol];     // initial <t,v> for pullup (0)
        // run through tvlist, setting correct values for pullup and pulldown gates
        tvlist.forEach(function(tvpair,index) {
            var t = tvpair[0];
            var v = tvpair[1];
            var E,A;
            if (v == '0') {
                // want enable on, data 0
                E = thresholds.Voh;
                A = thresholds.Vol;
            }
            else if (v == '1') {
                // want enable on, data 1
                E = thresholds.Voh;
                A = thresholds.Voh;
            }
            else if (v == 'Z' || v=='-') {
                // want enable off, data is don't care
                E = thresholds.Vol;
                A = thresholds.Vol;
            }
            else
                console.log('node: '+node+', tvlist: '+JSON.stringify(tvlist));
            // ramp to next control voltage over 0.1ns
            var last_E = e_pwl[e_pwl.length - 1];
            if (last_E != E) {
                if (t != e_pwl[e_pwl.length - 2])
                    e_pwl.push.apply(e_pwl,[t,last_E]);
                e_pwl.push.apply(e_pwl,[t+0.1e-9,E]);
            }
            var last_A = a_pwl[a_pwl.length - 1];
            if (last_A != A) {
                if (t != a_pwl[a_pwl.length - 2])
                    a_pwl.push.apply(a_pwl,[t,last_A]);
                a_pwl.push.apply(a_pwl,[t+0.1e-9,A]);
            }
        });
        // set up voltage sources for enable and data
        netlist.push({type: 'voltage source',
                      connections: {nplus: node+'_enable', nminus: 'gnd'},
                      properties: {name: node+'_enable_source', value: {type: 'pwl', args: e_pwl}}});
        netlist.push({type: 'voltage source',
                      connections: {nplus: node+'_data', nminus: 'gnd'},
                      properties: {name: node+'_data_source', value: {type: 'pwl', args: a_pwl}}});
    });
}

// return string describing timing results
function timing_analysis(netlist,options,maxpaths,benchmarkTime) {
    if (options === undefined) options = {};
    if (maxpaths === undefined) maxpaths = 10;
    if (benchmarkTime === undefined) throw Error('timing_analysis: benchmarkTime was not specified. Contact course staff for assistance.');

    options.timing_analysis = true;
    var network = new Network(netlist, options);

    var analysis;
    try {
        analysis = network.get_timing_info();
        
        const timing = analysis.timing;
        const timingArray = Object.entries(timing);

        timingArray.sort((a, b) => {
            const pdSumA = a[1].pd_sum;
            const pdSumB = b[1].pd_sum;
            return pdSumB - pdSumA;
        });

        largestTPD = timingArray[0]["1"].pd_sum;
        console.log("INFO: Largest TPD: "+largestTPD);
        result = (largestTPD <= benchmarkTime) ? 0 : -1; // 0 = pass, -1 = fail
        //console.log(analysis.timing);
    } catch (e) {
        throw "Oops, timing analysis failed:\n"+e+"\nContact course staff for assistance.";
    }

    return result;
}

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  A BUNCH OF NETWORK STUFF
    //
    //////////////////////////////////////////////////////////////////////////////

    function Network(netlist, options) {
        this.N = 0;
        this.node_map = {};
        this.aliases = {};
        this.nodes = [];
        this.devices = []; // list of devices
        this.device_map = {}; // name -> device
        this.event_queue = new Heap();
        this.options = options || {};
        this.debug_level = this.options.debug || 0;
        this._network_ = this; // self-reference for compatibility with cktsim

        if (netlist !== undefined) this.load_netlist(netlist, options);
    }

    // find anchor of alias chain
    Network.prototype.unalias = function (name) {
        while (this.aliases[name] !== undefined) name = this.aliases[name];
        return name;
    };

    // make name1 and name2 refer to the same node
    Network.prototype.make_alias = function (name1,name2) {
        name1 = this.unalias(name1);   // strip away the masks!
        name2 = this.unalias(name2);
        if (name1 == name2) return;    // already aliased!

        // how many levels in hierarchical name?
        var levels_1 = (name1.match(/\./g) || []).length;
        var levels_2 = (name2.match(/\./g) || []).length;

        // figure out which name becomes the anchor of the alias chain:
        // gnd is always the anchor
        // top level names are preferred to hierarchical names
        // otherwise simply chose the shorter of the two names
        var winner,loser;
        if (name1 == 'gnd') { winner = name1; loser = name2; }
        else if (name2 == 'gnd') { winner = name2; loser = name1; }
        else if (levels_1 < levels_2) { winner = name1; loser = name2; }
        else if (levels_2 < levels_1) { winner = name2; loser = name1; }
        else if (name1.length <= name2.length) { winner = name1; loser = name2; }
        else { winner = name2; loser = name1; }

        this.aliases[loser] = winner;  // loser now points to winner as the anchor
    };

    // return Node object for specified name, create if necessary
    Network.prototype.node = function(name) {
        name = this.unalias(name);  // resolve name to canonical name

        // find Node in node_map or create a new Node
        var n = this.node_map[name];
        if (n === undefined) {
            n = new Node(name, this);
            this.node_map[name] = n;
            this.nodes.push(n);
            this.N += 1;
        }
        return n;
    };

    // load circuit from JSON netlist: [[device,[connections,...],{prop: value,...}]...]
    Network.prototype.load_netlist = function(netlist, options) {
        last_network = this;

        var network = this;
        network.N = 0;
        network.node_map = {};
        network.aliases = {};
        network.nodes = [];
        network.devices = []; // list of devices
        network.device_map = {}; // name -> device
        network.size = 0;     // total size
        network.counts = {};  // counts by device type
        network.sizes = {};   // sizes by device type

        // handle all the ground connections
        network.gnd = network.node('gnd');
        network.devices.push(new Source(network, 'gnd', network.gnd, {name: 'gnd', value: {type: 'dc', args: []}}));
        Object.entries(netlist).forEach(function ([i,component]) {
            if (component.type == 'ground') {
                network.node_map['gnd'] = network.gnd;
            }
        });

        // "connect a b ..." makes a, b, ... aliases for the same node
        Object.entries(netlist).forEach(function ([i,component]) {
            if (component.type == 'connect') {
                // collect all the names to be aliased
                var c = [];
                Object.entries(component.connections).forEach(function ([id,name]) { c.push(name); });

                // do pair-wise aliasing with first name on list
                for (var j = 1; j < c.length; j += 1)
                    network.make_alias(c[0],c[j]);
            }
        });

        // process each component in the JSON netlist (see schematic.js for format)
        Object.entries(netlist).forEach(function ([i,component]) {
            var n,d;
            var type = component.type;
            
            if (type == 'ground' || type == 'connect') return;  // handled above

            var connections = component.connections;
            var properties = component.properties;
            var name = properties.name;

            // convert node names to Nodes
            for (var c in connections) connections[c] = network.node(connections[c]);

            // process the component
            if (type in logic_gates) {
                var info = logic_gates[type]; // [input-list,output,table]
                // build input and output lists using terminal names in info array
                var inputs = [];
                Object.entries(info[0]).forEach(function ([j,cname]) { inputs.push(connections[cname]); });
                // create a new device
                new LogicGate(network, type, name, info[2], inputs, connections[info[1]], properties);
            }
            else if (type == 'dreg' || type == 'dlatch' || type == 'dlatchn') {
                new Storage(network, name, type, connections, properties);
            }
            else if (type == 'memory') {
                // convert node names to Nodes
                Object.entries(properties.ports).forEach(function ([i, port]) {
                    Object.entries(port.addr).forEach(function ([j,name]) { port.addr[j] = network.node(name); });
                    Object.entries(port.data).forEach(function ([j,name]) { port.data[j] = network.node(name); });
                    // make a separate list of output nodes so that tristate buses can successfully
                    // insert BUS devices on the outputs without affecting the input ndoes
                    port.data_out = port.data.slice(0);
                    port.clk = network.node(port.clk);
                    port.wen = network.node(port.wen);
                    port.oe = network.node(port.oe);
                });

                new Memory(network, name, properties, options);
            }
            else if (type == 'constant0' || type == 'constant1') {
                n = connections.z;
                if (n.drivers.length > 0) return; // already handled this one
                n.v = (type == 'constant0' ? V0 : V1);   // should be set by initialization of LogicGate that drives this node
                new LogicGate(network, type, name, type == 'constant0' ? LTable:HTable, [], n, properties);
            }
            else if (type == 'voltage source') {
                n = connections.nplus; // hmmm.
                if (n.drivers.length > 0) return; // already handled this one
                new Source(network, name,  n, properties);
            }
            else throw 'Unrecognized gate: ' + type;
        });

        // give each Node a chance to finalize itself
        Object.entries(network.node_map).forEach(function ([n,node]) { node.finalize(); });
    };

    Network.prototype.report = function() {
        var network = this;
        var result = $('<div style="padding:5px"></div>');

        // Benmark = 1e-10/(size_in_m**2 * simulation_time_in_s)
        var benmark = 1e-10/((network.size*1e-12) * network.time);
        result.append('Benmark: '+benmark.toFixed(2));

        // min observed setup time
        var min_setup = undefined;
        var min_setup_time = undefined;
        var min_setup_device = undefined;
        Object.entries(network.devices).forEach(function ([i,device]) {
            if (device.min_setup) {
                if (min_setup === undefined || device.min_setup < min_setup) {
                    min_setup = device.min_setup;
                    min_setup_time = device.min_setup_time;
                    min_setup_device = device.name;
                }
            }
        });
        if (min_setup) {
            result.append('<p>Min observed setup time: '+(min_setup*1e9).toFixed(2)+'ns at time='+(min_setup_time*1e9).toFixed(0)+'ns for device '+min_setup_device);
        }

        // table of component counts and sizes
        var tbl = $('<table class="size-table" border="1" cellpadding="3" style="border-collapse:collapse"><tr><th>Component</th><th>Count</th><th>Size (\u03BC\u00B2)</th></tr></table>');
        tbl.append('<tr><td><i>nodes</i></td><td class="number">'+this.N+'</td><td></td></tr>');

        var total = 0;
        var types = [];
        Object.entries(network.counts).forEach(function ([type,count]) {
            types.push(type);
            total += count;
        });
        types.sort();
        var size,total = 0;
        Object.entries(types).forEach(function ([i,type]) {
            total += network.counts[type];
            size = network.sizes[type];
            if (size === undefined) size = '';
            tbl.append('<tr><td>'+type+'</td><td class="number">'+network.counts[type]+'</td><td class="number">'+size+'</td></tr>');
        });
        tbl.append('<tr><td><b>Totals</b></td><td class="number"><b>'+total+'</b></td><td class="number"><b>'+network.size+'</b></td></tr>');
        result.append('<p>',tbl);

        return result;
    };

    Network.prototype.add_component = function(device) {
        var type = device.type;
        this.devices.push(device);
        this.counts[type] = (this.counts[type] || 0) + 1;
        if (device.name) this.device_map[device.name] = device;
        if (device.size) {
            this.size += device.size;
            this.sizes[type] = (this.sizes[type] || 0) + device.size;
        }
    };

    // initialize for simulation, queue initial events
    Network.prototype.initialize = function(progress, tstop) {
        this.progress = progress;
        this.tstop = tstop;
        this.event_queue.clear();
        this.time = 0;

        // initialize nodes
        var i;
        for (i = 0; i < this.nodes.length; i += 1) this.nodes[i].initialize();

        // queue initial events
        for (i = 0; i < this.devices.length; i += 1) this.devices[i].initialize();
    };

    // tupdate is the wall-clock time at which we should take a quick coffee break
    // to let the UI update
    Network.prototype.simulate = function(tupdate) {
        var ecount = 0;
        if (!this.progress.stop_requested) { // halt when user clicks stop
            while (this.time < this.tstop && !this.event_queue.empty()) {
                var event = this.event_queue.pop();
                this.time = event.time;
                event.node.process_event(event);

                // check for coffee break every 1000 events
                if (++ecount < 1000) continue;
                else ecount = 0;

                var t = new Date().getTime();
                if (t >= tupdate) {
                    // update progress bar
                    var completed = Math.round(100 * this.time / this.tstop);
                    this.progress.update(completed);

                    // a brief break in the action to allow progress bar to update
                    // then pick up where we left off
                    var nl = this;
                    setTimeout(function() {
                        try {
                            nl.simulate(t + nl.progress.update_interval);
                        }
                        catch (e) {
                            if (typeof e == 'string') nl.progress.finish(e);
                            else throw e;
                        }
                    }, 1);

                    // our portion of the work is done
                    return;
                }
            }
            this.time = this.tstop;
        }

        // simulation complete or interrupted
        this.progress.finish(undefined);
    };

    Network.prototype.add_event = function(t, type, node, v) {
        var event = new Event(t, type, node, v);
        this.event_queue.push(event);
        if (this.debug_level > 2) console.log("add "+"cp"[type]+" event: "+node.name+"->"+"01XZ"[v]+" @ "+t);
        return event;
    };

    Network.prototype.remove_event = function(event) {
        this.event_queue.removeItem(event);
        if (this.debug_level > 2) console.log("remove "+"cp"[event.type]+" event: "+event.node.name+"->"+"01XZ"[event.v]+" @ "+event.time);
    };
    
    // return {xvalues: array, yvalues: array}, undefined if node has no events.
    // yvalues are 0, 1, 2=X, 3=Z
    Network.prototype.history = function(node) {
        node = this.unalias(node);  // find actual node referred to
        var n = this.node_map[node];
        if (n === undefined) return undefined;

        // record node's final value if not already there
        if (n.times[n.times.length - 1] != this.time) {
            n.times.push(this.time);  
            n.values.push(n.v);
        }
        return {xvalues: n.times, yvalues: n.values};
    };

    // return contents of named memory as an array of values
    Network.prototype.get_memory = function(mem_name) {
        var mem = this.device_map[mem_name];

        if (mem !== undefined && mem.type == 'memory') return mem.get_contents();
        else return undefined;
    };

    Network.prototype.result_type = function() { return 'digital'; };

    Network.prototype.node_list = function() {
        var nlist = [];
        for (var n in this.node_map) nlist.push(n);
        return nlist;
    };

    // run a timing analysis for the network
    Network.prototype.get_timing_info = function() {
        var clocks = [];
        var timing = {};

        Object.entries(this.node_map).forEach(function([node,n]) {
            if (n.clock) clocks.push(n);
            timing[node] = n.get_timing_info();
        });

        return {clocks: clocks, timing: timing};
    };

///////////////////////////////////////////////////////////////////////////////
//
//  SOME HEAP STUFF
//
///////////////////////////////////////////////////////////////////////////////

function Heap() {
    this.nodes = [];
}

// test heap invariant
Heap.prototype.assert = function() {
    var len = this.nodes.length;
    var i,j;
    for (i = 0; i < len; i += 1) {
        j = 2*i + 1;
        if (j < len && this.nodes[i].time > this.nodes[j].time) {
            throw 'heap error 1';
        }
        if (j+1 < len && this.nodes[i].time > this.nodes[j+1].time) {
            throw 'heap error 2';
        }
    }
};

// specialized for events...
Heap.prototype.cmplt = function(e1, e2) {
    return e1.time < e2.time;
};

// 'heap' is a heap at all indices >= startpos, except possibly for pos.  pos
// is the index of a leaf with a possibly out-of-order value.  Restore the
// heap invariant.
Heap.prototype._siftdown = function(startpos, pos) {
    var newitem, parent, parentpos;
    newitem = this.nodes[pos];
    // follow the path to the root
    while (pos > startpos) {
        parentpos = (pos - 1) >> 1;
        parent = this.nodes[parentpos];
        if (this.cmplt(newitem, parent)) {
            this.nodes[pos] = parent;
            pos = parentpos;
            continue;
        }
        break;
    }
    this.nodes[pos] = newitem;
};

// The child indices of heap index pos are already heaps, and we want to make
// a heap at index pos too.  We do this by bubbling the smaller child of
// pos up (and so on with that child's children, etc) until hitting a leaf,
// then using _siftdown to move the oddball originally at index pos into place.
Heap.prototype._siftup = function(pos) {
    var childpos, endpos, newitem, rightpos, startpos;
    endpos = this.nodes.length;
    startpos = pos;
    newitem = this.nodes[pos];
    // bubble up the smaller child until hitting a leaf
    childpos = 2 * pos + 1;
    while (childpos < endpos) {
        // set childpos to index of smaller child
        rightpos = childpos + 1;
        if (rightpos < endpos && !(this.cmplt(this.nodes[childpos], this.nodes[rightpos]))) {
            childpos = rightpos;
        }
        // move the smaller child up
        this.nodes[pos] = this.nodes[childpos];
        pos = childpos;
        childpos = 2 * pos + 1;
    }
    // the leaf at pos is empty now.  Put newitem there and bubble it up
    // to its final resitng place (by sifting its parents down)
    this.nodes[pos] = newitem;
    this._siftdown(startpos, pos);
};

// add new item to the heap
Heap.prototype.push = function(item) {
    this.nodes.push(item);
    this._siftdown(0, this.nodes.length - 1);
};

// remove smallest item from the head
Heap.prototype.pop = function() {
    var lastelt, returnitem;
    lastelt = this.nodes.pop();
    if (this.nodes.length) {
        returnitem = this.nodes[0];
        this.nodes[0] = lastelt;
        this._siftup(0);
    }
    else {
        returnitem = lastelt;
    }
    return returnitem;
};

// see what smallest item is without removing it
Heap.prototype.peek = function() {
    return this.nodes[0];
};

// is item on the heap?
Heap.prototype.contains = function(item) {
    return this.nodes.indexOf(item) !== -1;
};

// rebuild heap after changing an item in the heap
Heap.prototype.updateItem = function(item) {
    var pos = this.nodes.indexOf(item);
    if (pos != -1) {
        this._siftdown(0, pos);
        this._siftup(pos);
    }
};

// remove an item from the head
Heap.prototype.removeItem = function(item) {
    var pos = this.nodes.indexOf(item);
    if (pos != -1) {
        // replace item to be removed with last element of heap
        // then sift it up to where it belongs
        var lastelt = this.nodes.pop();
        if (item !== lastelt) {
            this.nodes[pos] = lastelt;
            this._siftdown(0, pos);
            this._siftup(pos);
        }
    }
};

// clear the heap
Heap.prototype.clear = function() {
    return this.nodes = [];
};

// is the heap empty?
Heap.prototype.empty = function() {
    return this.nodes.length === 0;
};

// how many items on the heap?
Heap.prototype.size = function() {
    return this.nodes.length;
};

///////////////////////////////////////////////////////////////////////////////
//
//  SOME NODE STUFF
//
///////////////////////////////////////////////////////////////////////////////

var V0 = 0; // node values
var V1 = 1;
var VX = 2;
var VZ = 3;

var c_slope = 0; // F/terminal of interconnect capacitance
var c_intercept = 0; // F of interconnect capacitance

function Node(name, network) {
    this.name = name;
    this.network = network;

    this.drivers = []; // devices which want to control value of this node
    this.driver = undefined; // device which controls value of this node
    this.fanouts = []; // devices with this node as an input
    this.capacitance = 0; // nodal capacitance
}

Node.prototype.initialize = function() {
    this.v = VX;
    this.times = [0.0]; // history of events
    this.values = [VX];
    this.cd_event = undefined; // contamination delay event for this node
    this.pd_event = undefined; // propagation delay event for this node

    // for timing analysis
    this.clock = false; // is this node connected to clock input of state device
    this.timing_info = undefined; // min tCD, max tPD for this node
    this.in_progress = false; // flag to catch combinational cycles
};

Node.prototype.add_fanout = function(device) {
    if (this.fanouts.indexOf(device) == -1) this.fanouts.push(device);
};

Node.prototype.add_driver = function(device) {
    this.drivers.push(device);
};

Node.prototype.process_event = function(event) {
    // update event pointers
    if (event == this.cd_event) this.cd_event = undefined;
    else if (event == this.pd_event) this.pd_event = undefined;
    else console.log('unknown event!',this.name,this.network.time);

    if (this.v != event.v) {
        // record changes in node's value
        this.times.push(event.time);
        this.values.push(event.v);
    }

    if (this.network.debug_level > 0) {
        console.log(this.name + ": " + "01XZ"[this.v] + "->" + "01XZ"[event.v] + " @ " + event.time + [" contamination"," propagation"][event.type]);
    }

    this.v = event.v;

    // let fanouts know about event
    for (var i = this.fanouts.length - 1; i >= 0; i -= 1) {
        if (this.network.debug_level > 1) console.log ("Evaluating ("+"cp"[event.type]+") "+this.fanouts[i].name+" @ "+event.time);
        this.fanouts[i].process_event(event,this);
    }
};

Node.prototype.last_event_time = function () {
    return this.times[this.times.length - 1];
};

Node.prototype.finalize = function() {
    if (this.drivers === undefined || this.driver !== undefined) return; // already finalized

    // if no explicit capacitance has been supplied, estimate
    // interconnect capacitance
    var ndrivers = this.drivers.length;
    var nfanouts = this.fanouts.length;
    if (ndrivers === 0) {
        if (nfanouts > 0) {
            if (!this.network.options.timing_analysis) {
                var connections = [];
                Object.entries(this.fanouts).forEach(function ([index,d]) { connections.push(d.name); });
                throw 'Node ' + this.name + ' is not connected to any output<br>but is an input to the following devices:<li>'+connections.join('<li>');
            }
        } else return;  // no drivers, no fanouts... not interesting :)  
    }
    if (this.capacitance === 0) this.capacitance = c_intercept + c_slope * (ndrivers + nfanouts);

    // add capacitances from drivers and fanout connections
    var i,d;
    for (i = 0; i < ndrivers; i += 1)
        this.capacitance += this.drivers[i].capacitance(this);
    for (i = 0; i < nfanouts; i += 1)
        this.capacitance += this.fanouts[i].capacitance(this);

    // if there is only 1 driver then that device is the driver for this node
    if (ndrivers <= 1) {
        this.driver = this.drivers[0];
        this.drivers = undefined;
        return;
    }

    // handle tristates and multiple drivers by adding a special BUS
    // device that computes value from all the drivers
    var inputs = [];
    for (i = 0; i < ndrivers; i += 1) {
        d = this.drivers[i];
        if (!d.tristate(this)) {
            // shorting together non-tristate outputs, so complain
            var msg = 'Node ' + this.name + ' is driven by multiple gates.  See devices:<br>';
            for (var j = 0; j < ndrivers; j += 1)
                msg += '<li>'+this.drivers[j].name;
            throw msg;
        }
        // cons up a new node and have this device drive it
        var n = this.network.node(this.name + '$' + i.toString());
        n.capacitance = this.capacitance; // each driver has to drive all the capacitance
        inputs.push(n);
        d.change_output_node(this, n);
        n.driver = d;
    }

    // now add the BUS device to drive the current node
    this.capacitance = 0;  // already accounted for on BUS inputs
    this.driver = new LogicGate(this.network, 'BUS', this.name + '%bus', BusTable, inputs, this, {}, true);
    this.drivers = undefined; // finalization complete
};

// schedule contamination event for this node
Node.prototype.c_event = function(tcd) {
    var t = this.network.time + tcd;

    // remove any pending propagation event that happens after tcd
    if (this.pd_event && this.pd_event.time >= t) {
        this.network.remove_event(this.pd_event);
        this.pd_event = undefined;
    }

    // if we've already scheduled a contamination event for an earlier
    // time, make the conservative assumption that node will become
    // contaminated at the earlier possible time, i.e., keep the
    // earlier of the two contamination events
    if (this.cd_event) {
        if (this.cd_event.time <= t) return;
        this.network.remove_event(this.cd_event);
    }

    this.cd_event = this.network.add_event(t, CONTAMINATE, this, VX);
};

// schedule propagation event for this node
Node.prototype.p_event = function(tpd, v, drive, lenient) {
    var t = this.network.time + tpd + drive * this.capacitance;

    if (this.pd_event) {
        // an earlier arriving input may have already determined the
        // value of this node, so leave that event in place if we're
        // a lenient gate
        if (lenient && this.pd_event.v == v && t >= this.pd_event.time) return;
        this.network.remove_event(this.pd_event);
    }

    this.pd_event = this.network.add_event(t, PROPAGATE, this, v);
};

// for timing analyses
Node.prototype.is_input = function () {
    return this.driver === undefined || this.driver instanceof Source;
};

Node.prototype.is_output = function () {
    return this.fanouts.length === 0 && this.driver !== undefined &&
        !(this.driver instanceof Source) && this.name.indexOf('.') == -1;
};

Node.prototype.get_timing_info = function() {
    if (this.timing_info === undefined) {
        if (this.is_input()) {
            this.timing_info = new TimingInfo(this.name,this);
        } else {
            if (this.in_progress)
                throw "Combinational cycle detected:\n  "+this.name;
            try {
                this.in_progress = true;
                // recursively compute timing info for this node
                this.timing_info = this.driver.get_timing_info(this);
                this.in_progress = false;
            } catch (e) {
                this.in_progress = false;
                // add our name to the end of the combinational cycle enumeration
                throw e + "\n  " + this.name;
            }
        }
    }
    return this.timing_info;
};

///////////////////////////////////////////////////////////////////////////////
//
//  SOME SOURCE STUFF
//
///////////////////////////////////////////////////////////////////////////////

function Source(network, name, output, properties) {
    this.type = 'voltage source';
    this.network = network;
    this.name = name;
    this.output = output;

    this.vil = network.options.vil || 0.1;
    this.vih = network.options.vih || 0.9;

    var v = utils.parse_source(properties.value);
    if (v.fun == 'sin') throw "Can't use sin() sources in gate-level simulation";

    if (v.fun == 'dc') {
        output.constant_value = true;
        this.tvpairs = [0, v.args[0]];   // single t,v pair
        this.period = 0;
    } else {
        this.tvpairs = v.tvpairs;
        this.period = v.period;

        // for periodic source, construct two periods of tvpairs so that
        // it's easy to search for next transition when it's in the next
        // period.
        if (this.period !== 0) {
            this.tvpairs = this.tvpairs.slice(0);  // copy tv pairs
            for (var i = 0; i < v.tvpairs.length; i += 2) {
                this.tvpairs.push(v.tvpairs[i] + this.period);  // time in the next period
                this.tvpairs.push(v.tvpairs[i+1]);   // voltage
            }
        }
    }

    // figure out initial value from first t,v pair
    this.initial_value = this.tvpairs[1] <= this.vil ? V0 : (this.tvpairs[1] >= this.vih ? V1 : VX);

    output.add_fanout(this);    // listen for our own events!
    output.add_driver(this);

    network.add_component(this);
}

Source.prototype.change_output_node = function(old_node,new_node) {
    if (this.output == old_node) this.output = new_node;
};

Source.prototype.initialize = function() {
    if (this.initial_value != VX)
        this.output.p_event(0,this.initial_value,0,false);
};

Source.prototype.capacitance = function(node) {
    return 0;
};

// is node a tristate output of this device?
Source.prototype.tristate = function(node) {
    return false;
};

// figure out next event for source -- triggered by last event!
Source.prototype.process_event = function(event,cause) {
    var time = this.network.time;
    var t,v;

    // propagate events on source's output cause new events
    // to be scheduled for *next* source transition
    if (event.type == PROPAGATE) {
        t = this.next_contamination_time(time);
        if (t >= 0) this.output.c_event(t - time);
        //console.log(this.output.name + ": "+(t * 1e9).toFixed(2) + ' -> contaminate');

        t = this.next_propagation_time(time);
        if (t.time > 0) this.output.p_event(t.time - time, t.value, 0, false);
        //console.log(this.output.name + ": "+(t.time * 1e9).toFixed(2) + ' -> ' + "01XZ"[t.value]);
    }
};

// return time of next contamination event for pwl source
Source.prototype.next_contamination_time = function(xtime) {
    xtime += 1e-13;  // get past current time by epsilon

    // handle periodic sources
    var time = xtime;   // time we'll be searching for in tvpairs
    var tbase = 0;      // time at beginning of period
    if (this.period !== 0) {
        time = Math.fmod(time,this.period);
        tbase = xtime - time;
    }

    var tlast = 0;
    var vlast = 0;
    var npairs = this.tvpairs.length;
    var et;
    for (var i = 0; i < npairs; i += 2) {
        var t = this.tvpairs[i];
        var v = this.tvpairs[i+1];
        if (i > 0 && time <= t) {
            if (vlast >= this.vih && v < this.vih) {
                et = tlast + (t - tlast)*(this.vih - vlast)/(v - vlast);
                if (et > time) return tbase+et;
            }
            else if (vlast <= this.vil && v > this.vil) {
                et = tlast + (t - tlast)*(this.vil - vlast)/(v - vlast);
                if (et > time) return tbase+et;
            }
        }
        tlast = t;
        vlast = v;
    }
    return -1;
};

// return {time:t, value: v} of next propagation event for pwl source
Source.prototype.next_propagation_time = function (xtime) {
    xtime += 1e-13;  // get past current time by epsilon

    // handle periodic sources
    var time = xtime;   // time we'll be searching for in tvpairs
    var tbase = 0;      // time at beginning of period
    if (this.period !== 0) {
        time = Math.fmod(time,this.period);
        tbase = xtime - time;
    }

    var tlast = 0;
    var vlast = 0;
    var npairs = this.tvpairs.length;
    var et;
    for (var i = 0; i < npairs; i += 2) {
        var t = this.tvpairs[i];
        var v = this.tvpairs[i+1];
        if (i > 0 && time <= t) {
            if (vlast < this.vih && v >= this.vih) {
                et = tlast + (t - tlast)*(this.vih - vlast)/(v - vlast);
                if (et > time) return {time: tbase+et, value: V1};
            }
            else if (vlast > this.vil && v <= this.vil) {
                et = tlast + (t - tlast)*(this.vil - vlast)/(v - vlast);
                if (et > time) return {time: tbase+et, value: V0};
            }
        }
        tlast = t;
        vlast = v;
    }
    return {time: -1};
};

Source.prototype.get_clock_info = function(clk) {
    return undefined;
};

///////////////////////////////////////////////////////////////////////////////
//
//  SOME TIMING INFO STUFF
//
///////////////////////////////////////////////////////////////////////////////

function TimingInfo(name,node,device,tcd,tpd) {
    this.name = name;  // name to use in reports (sometimes differs from node.name)
    this.node = node;  // associated node
    this.device = device;  // what device determined this info

    this.cd_sum = 0;  // min cummulative tCD from inputs to here
    this.cd_link = undefined;  // previous TimingInfo in tCD path
    this.pd_sum = 0;  // max cummulative tPD from inputs to here
    this.pd_link = undefined;  // previous TimingInfo in tPD path

    this.tcd = tcd || 0;  // specs for driving gate, capacitance accounted for
    this.tpd = tpd || 0;
}

TimingInfo.prototype.get_tcd_source = function () {
    var t = this;
    while (t.cd_link !== undefined) t = t.cd_link;
    return {node: t.node, name: t.name};
};

TimingInfo.prototype.get_tpd_source = function () {
    var t = this;
    while (t.pd_link !== undefined) t = t.pd_link;
    return {node: t.node, name: t.name};
};

// using timing info from an input, updated timing info for associated node
TimingInfo.prototype.set_delays = function (tinfo) {
    var t;

    // update min tCD
    t = tinfo.cd_sum + this.tcd;
    if (this.cd_link === undefined || t < this.cd_sum) {
        this.cd_link = tinfo;
        this.cd_sum = t;
    }

    // update max tPD
    t = tinfo.pd_sum + this.tpd;
    if (this.pd_link === undefined || t > this.pd_sum) {
        this.pd_link = tinfo;
        this.pd_sum = t;
    }
};

function format_float(n,width,decimal_places) {                                                        
    var result = n.toFixed(decimal_places);                                                            
    while (result.length < width) result = ' '+result;                                                 
    return result;                                                                                             
}                                                                                                      
      
// recursively describe tPD path
TimingInfo.prototype.describe_tpd = function () {
    var result;
    if (this.pd_link !== undefined) result = this.pd_link.describe_tpd();
    else result = '';

    var driver_name = (this.device !== undefined) ? ' ['+this.device.name+' '+this.device.type+']' : '';
    result += '    + '+format_float(this.tpd*1e9,6,3)+"ns = "+format_float(this.pd_sum*1e9,6,3)+"ns "+this.name+driver_name+'\n';
    return result;
};

// recursively describe tCD path
TimingInfo.prototype.describe_tcd = function () {
    var result;
    if (this.cd_link !== undefined) result = this.cd_link.describe_tcd();
    else result = '';

    var driver_name = (this.device !== undefined) ? ' ['+this.device.name+']' : '';
    // when calculating hold time violations, tcd for register is negative...
    result += '    '+(this.tcd < 0 ? '-' : '+');
    result += ' '+format_float(Math.abs(this.tcd)*1e9,6,3)+"ns = "+format_float(this.cd_sum*1e9,6,3)+"ns "+this.name+driver_name+'\n';
    return result;
};

///////////////////////////////////////////////////////////////////////////////
//
//  Logic gates
//
///////////////////////////////////////////////////////////////////////////////

// it's tables all the way down
// use current input as index into current table to get new table
// repeat until all inputs have been consumed
// final value is given by current_table[4]

var LTable = [];
LTable.push(LTable, LTable, LTable, LTable, 0); // always "0"
var HTable = [];
HTable.push(HTable, HTable, HTable, HTable, 1); // always "1"
var XTable = [];
XTable.push(XTable, XTable, XTable, XTable, 2); // always "X"
var ZTable = [];
ZTable.push(ZTable, ZTable, ZTable, ZTable, 3); // always "Z"
var SelectTable = [LTable, HTable, XTable, XTable, 2]; // select this input
var Select2ndTable = [SelectTable, SelectTable, SelectTable, SelectTable, 2]; // select second input
var Select3rdTable = [Select2ndTable, Select2ndTable, Select2ndTable, Select2ndTable, 2]; // select third input
var Select4thTable = [Select3rdTable, Select3rdTable, Select3rdTable, Select3rdTable, 2]; // select fourth input
var Ensure0Table = [LTable, XTable, XTable, XTable, 2]; // must be 0
var Ensure1Table = [XTable, HTable, XTable, XTable, 2]; // must be 1
var EqualTable = [Ensure0Table, Ensure1Table, XTable, XTable, 2]; // this == next

// tristate bus resolution
// produces "Z" if all inputs are "Z"
// produces "1" if one input is "1" and other inputs are "1" or "Z"
// produces "0" if one input is "0" and other inputs are "0" or "Z"
// produces "X" otherwise
var BusTable = [];
var Bus0Table = [];
var Bus1Table = [];
BusTable.push(Bus0Table, Bus1Table, XTable, BusTable, 3);
Bus0Table.push(Bus0Table, XTable, XTable, Bus0Table, 0);
Bus1Table.push(XTable, Bus1Table, XTable, Bus1Table, 1);

// tristate buffer (node order: enable,in)
var TristateBufferTable = [ZTable, SelectTable, XTable, XTable, 2];

// and tables
var AndXTable = [];
AndXTable.push(LTable, AndXTable, AndXTable, AndXTable, 2);
var AndTable = [];
AndTable.push(LTable, AndTable, AndXTable, AndXTable, 1);

// nand tables
var NandXTable = [];
NandXTable.push(HTable, NandXTable, NandXTable, NandXTable, 2);
var NandTable = [];
NandTable.push(HTable, NandTable, NandXTable, NandXTable, 0);

// or tables
var OrXTable = [];
OrXTable.push(OrXTable, HTable, OrXTable, OrXTable, 2);
var OrTable = [];
OrTable.push(OrTable, HTable, OrXTable, OrXTable, 0);

// nor tables
var NorXTable = [];
NorXTable.push(NorXTable, LTable, NorXTable, NorXTable, 2);
var NorTable = [];
NorTable.push(NorTable, LTable, NorXTable, NorXTable, 1);

// xor tables
var XorTable = [];
var Xor1Table = [];
XorTable.push(XorTable, Xor1Table, XTable, XTable, 0);
Xor1Table.push(Xor1Table, XorTable, XTable, XTable, 1);
var XnorTable = [];
var Xnor1Table = [];
XnorTable.push(XnorTable, Xnor1Table, XTable, XTable, 1);
Xnor1Table.push(Xnor1Table, XnorTable, XTable, XTable, 0);

// 2-input mux table (node order: sel,d0,d1)
var Mux2Table = [SelectTable, Select2ndTable, EqualTable, EqualTable, 2];

// 4-input mux table (node order: s0,s1,d0,d1,d2,d3)
var Mux4aTable = [SelectTable, Select3rdTable, EqualTable, EqualTable, 2]; // s0 == 0
var Mux4bTable = [Select2ndTable, Select4thTable, EqualTable, EqualTable, 2]; // s0 == 1
var Mux4Table = [Mux4aTable, Mux4bTable, EqualTable, EqualTable, 2];

// for each logic gate provide [input-terminal-list,output-terminal,table]
var logic_gates = {
    'and2': [['a', 'b'], 'z', AndTable],
    'and3': [['a', 'b', 'c'], 'z', AndTable],
    'and4': [['a', 'b', 'c', 'd'], 'z', AndTable],
    'buffer': [['a'], 'z', AndTable],
    'buffer_h': [['a'], 'z', AndTable],
    'inverter': [['a'], 'z', NandTable],
    'mux2': [['s', 'd0', 'd1'], 'y', Mux2Table],
    'mux4': [['s[0]', 's[1]', 'd0', 'd1', 'd2', 'd3'], 'y', Mux4Table],
    'nand2': [['a', 'b'], 'z', NandTable],
    'nand3': [['a', 'b', 'c'], 'z', NandTable],
    'nand4': [['a', 'b', 'c', 'd'], 'z', NandTable],
    'nor2': [['a', 'b'], 'z', NorTable],
    'nor3': [['a', 'b', 'c'], 'z', NorTable],
    'nor4': [['a', 'b', 'c', 'd'], 'z', NorTable],
    'or2': [['a', 'b'], 'z', OrTable],
    'or3': [['a', 'b', 'c'], 'z', OrTable],
    'or4': [['a', 'b', 'c', 'd'], 'z', OrTable],
    'tristate': [['e', 'a'], 'z', TristateBufferTable],
    'xor2': [['a', 'b'], 'z', XorTable],
    'xnor2': [['a', 'b'], 'z', XnorTable]
};

function LogicGate(network, type, name, table, inputs, output, properties) {
    this.network = network;
    this.type = type;
    this.name = name;
    this.table = table;
    this.inputs = inputs;
    this.output = output;
    this.properties = properties;
    this.size = properties.size || 0;

    // by default logic gates are lenient
    this.lenient = (properties.lenient === undefined) ? true : properties.lenient !== 0;
    // but devices with 0 or 1 inputs are lenient by definition!
    if (inputs.length < 2) this.lenient = true;

    // gates with no input generate constant value outputs
    if (inputs.length === 0) output.constant_value = true;

    this.cout = properties.cout || 0;
    this.cin = properties.cin || 0;
    this.tcd = properties.tcd || 0;
    this.tpdf = properties.tpdf || properties.tpd || 0;
    this.tpdr = properties.tpdr || properties.tpd || 0;
    this.tr = properties.tr || 0;
    this.tf = properties.tf || 0;

    for (var i = 0; i < inputs.length ; i+= 1) inputs[i].add_fanout(this);
    output.add_driver(this);

    var in0 = inputs[0];
    var in1 = inputs[1];
    var in2 = inputs[2];
    var in3 = inputs[3];
    var in4 = inputs[4];
    var in5 = inputs[5];
    if (inputs.length === 0) this.logic_eval = function() {
        return table[4];
    };
    else if (inputs.length == 1) this.logic_eval = function() {
        return table[in0.v][4];
    };
    else if (inputs.length == 2) this.logic_eval = function() {
        return table[in0.v][in1.v][4];
    };
    else if (inputs.length == 3) this.logic_eval = function() {
        return table[in0.v][in1.v][in2.v][4];
    };
    else if (inputs.length == 4) this.logic_eval = function() {
        return table[in0.v][in1.v][in2.v][in3.v][4];
    };
    else if (inputs.length == 5) this.logic_eval = function() {
        return table[in0.v][in1.v][in2.v][in3.v][in4.v][4];
    };
    else if (inputs.length == 6) this.logic_eval = function() {
            var v0,v1;

            // special case eval function for mux4 with X's on select lines
            if (type == 'mux4' && (in0.v >= VX || in1.v >= VX)) {
                if (in0.v >= VX) {
                    if (in1.v >= VX) {
                        // both s0 and s1 are X
                        // check to see if d0 == d1 == d2 == d3 to see if selects matter
                        if (in2.v==in3.v && in2.v==in4.v && in2.v==in5.v) return in2.v;
                        else return VX;
                    } else {
                        // just s0 is X
                        // if s1 is 0, check to see if d0 == d1 to see if s0 matters
                        // otherwise, check to see if d2 == d3 to see if s0 matters
                        if (in1.v == V0) {
                            if (in2.v == in3.v) return in2.v;
                            else return VX;
                        } else {
                            if (in4.v == in5.v) return in4.v;
                            else return VX;
                        }
                    }
                } else {
                    // just s1 is X
                    // if s0 is 0, check to see if d0 == d2 to see if s1 matters
                    // otherwise, check to see if d1 == d3 to see if s1 matters
                    if (in0.v == V0) {
                        if (in2.v == in4.v) return in2.v;
                        else return VX;
                    } else {
                        if (in3.v == in5.v) return in3.v;
                        else return VX;
                    }
                }
            }

            // otherwise use tables to compute answer
            return table[in0.v][in1.v][in2.v][in3.v][in4.v][in5.v][4];
    };
    else this.logic_eval = function() {
        // handles arbitrary numbers of inputs (eg, for BusTable).
        var t = table;
        for (var i = 0; i < inputs.length ; i+= 1) t = t[inputs[i].v];
        return t[4];
    };

    network.add_component(this);
}

LogicGate.prototype.change_output_node = function(old_node,new_node) {
    if (this.output == old_node) this.output = new_node;
};

LogicGate.prototype.initialize = function() {
    if (this.inputs.length === 0) {
        // gates with no inputs will produce a constant output, so
        // figure that out now and process the appropriate event
        var v = this.logic_eval();
        this.output.p_event(0,v,0,false);
    }
};

// capacitance contribution from this device for node
LogicGate.prototype.capacitance = function(node) {
var c = 0;
for (var i = 0; i < this.inputs.length; i += 1)
    if (this.inputs[i] == node) c += this.cin;
if (this.output == node) c += this.cout;
return c;
};

// is node a tristate output of this device?
LogicGate.prototype.tristate = function(node) {
    if (this.output == node && this.table == TristateBufferTable) return true;
    else return false;
};

// show what logic gate is thinking at this moment
LogicGate.prototype.describe = function(prefix) {
    var inputs = [];
    for (var k = 0; k < this.inputs.length; k += 1) {
        inputs.push(this.inputs[k].name+"="+"01XZ".charAt(this.inputs[k].v));
    }
    var output = "01XZ".charAt(this.logic_eval());
    console.log((prefix||'')+this.name+":"+this.type+"("+inputs.join(',')+")="+output+
                " @ "+(this.network.time*1e9).toFixed(3));
    console.log("    output "+this.output.name+"="+"01XZ".charAt(this.output.v)+" @ "+
                (this.output.last_event_time()*1e9).toFixed(3));
};

// evaluation of output values triggered by an event on the input
LogicGate.prototype.process_event = function(event,cause) {
    var onode = this.output;
    var v;

    if (event.type == CONTAMINATE) {
        // a lenient gate won't contaminate the output under the right circumstances
        if (this.lenient) {
            v = this.logic_eval();
            if (onode.pd_event === undefined) {
                // no events pending and current value is same as new value
                if (onode.cd_event === undefined && v == onode.v) return;
            }
            else {
                // node is destined to have the same value as new value
                if (v == onode.pd_event.v) return;
            }
        }

        // schedule contamination event with specified delay
        onode.c_event(this.tcd);
    }
    else if (event.type == PROPAGATE) {
        // always forward propagate events to the output so
        // downstream gates will get a chance to recover from
        // an earlier contamination event.
        v = this.logic_eval();

        var drive, tpd;
        if (v == V1) { tpd = this.tpdr; drive = this.tr; }
        else if (v == V0) { tpd = this.tpdf; drive = this.tf; }
        else { tpd = Math.min(this.tpdr, this.tpdf); drive = 0; }
        onode.p_event(tpd, v, drive, this.lenient);
    }
};

LogicGate.prototype.get_timing_info = function(output) {
    var tr = this.tpdr + this.tr*output.capacitance;
    var tf = this.tpdf + this.tf*output.capacitance;
    var tinfo = new TimingInfo(output.name,output,this,this.tcd,Math.max(tr,tf));

    // loop through inputs looking for min/max paths
    for (var i = 0; i < this.inputs.length ; i+= 1) {
        // constant inputs don't contribute to timing
        if (this.inputs[i].constant_value) continue;
        tinfo.set_delays(this.inputs[i].get_timing_info());
    }
    return tinfo;
};

LogicGate.prototype.get_clock_info = function(clk) {
    return undefined;
};

do_express_test();