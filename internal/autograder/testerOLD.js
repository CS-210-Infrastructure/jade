const utils = require('./utils');
const gatesim = require('./gatesim');
const fs = require('fs');
const { exit } = require('process');

function do_express_test() {
    var test,netlist;
    if (process.argv[2] === undefined || process.argv[3] === undefined) {
        console.log('USAGE: node tester.js <test_file> <netlist_file>');
        exit(1);
    } else {
        console.log('INFO: Running express test...');
        console.log('INFO: Test File: '+process.argv[2]);
        console.log('INFO: Netlist File: '+process.argv[3]);
        try {
            test = fs.readFileSync(process.argv[2], 'utf8').replace(/\\\\/g, '\\');
            netlist = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        } catch (e) {
            console.log('ERROR: '+e);
            exit(1);
        }
    }
    //var test2 = ".power Vdd=1\n.thresholds Vol=0 Vil=0.1 Vih=0.9 Voh=1\n\n.group inputs A B\n.group outputs Y\n\n.mode gate\n\n.cycle assert inputs tran 99n sample outputs tran 1n\n\n1 1 L\n\n      \n.plot X(A)\n.plot X(B)\n.plot X(Y)"
    //var netlist2 = [{"type":"nand2","connections":{"z":"y","b":"b","a":"a"},"properties":{"name":"nand2_1","tcd":1e-11,"tpd":3e-11,"tr":4500,"tf":2800,"cin":4e-15,"size":10}}];
    try {
        express_test(test,netlist);
    } catch (e) {
        console.log('Error: '+e);
    }
    return;
}

function express_test(source,netlist) {
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

            test_result = 'passed '+ +benmark.toString();
            // Exit code is 0 by default.
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

do_express_test();