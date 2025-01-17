// save/restore state from browser's localStorage

jade_defs.services = function (jade) {
    var host;   // window target for state updates
    var jade_instance;  // jade instance whose state we'll save

    jade.model.set_autosave_trigger(1);  // save after every edit

    jade.load_from_server = function (filename,shared,callback) {
    };

    jade.save_to_server = function (json,callback) {
        try {
            // grab the complete state and save it away
            //var state = $('.jade')[0].jade.get_state();
            //localStorage.setItem(window.location.pathname,JSON.stringify(state));
            //if (callback) callback();

            // send to local server
            jade.cloud_upload($('.jade')[0].jade,window.location.origin,callback);
        } catch (e) {
            console.log('Failed to save state in localStorage.');
        }
    };

    jade.cloud_upload = function (j,url,callback) {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, value: JSON.stringify(j.get_state())},
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    const now = Date();
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'Your latest changes have not been saved to your device. ' +
                        'Please start the python server again and refresh this page ' +
                        'to continue. ' +
                        '\n\nTime of Failed Edit:\n'+requestTime
                        );
                } else { // server running, but error
                    console.log('Error processing edit: '+jqXHR.responseText);
                    alert('Error processing edit: '+jqXHR.responseText);
                }
            },
            success: function(result) {
                if (callback) callback();
                //console.log('upload complete');
            }
        };
        $.ajax(args);
    };

    jade.cloud_download = function (j,url) {
        if (url === undefined) url = j.configuration.cloud_url;
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname},
            error: function(jqXHR, textStatus, errorThrown) {
                console.log('Error: '+jqXHR.responseText);
                alert('Error: '+jqXHR.responseText+' Please start the server again.');
            },
            success: function(result) {
                //localStorage.setItem(window.location.pathname,result);
                var config = {};
                $.extend(config,initial_config);
                if (result) $.extend(config,JSON.parse(result));
                j.initialize(config);
            }
        };
        $.ajax(args);

        //console.log('cloud_download');
    };

    jade.switch_json = function (j,url,filename) {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, name: filename},
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    const now = Date();
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'Please start the python server again and refresh this page ' +
                        'to continue. ' +
                        '\n\nTime of Failed JSON Switch:\n'+requestTime
                        );
                } else { // server running, but error
                    console.log('Error during JSON Switch: '+jqXHR.responseText);
                    alert('Error during JSON Switch: '+jqXHR.responseText);
                }
            },
            success: function(result) {
                //localStorage.setItem(window.location.pathname,result);
                var config = {};
                $.extend(config,initial_config);
                if (result) $.extend(config,JSON.parse(result));
                j.initialize(config);
                window.location.reload();
            }
        };
        $.ajax(args);

        //console.log('switch_json');
    };

    jade.stop_server = function(j,url) {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, stop: "TRUE"},
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'The server has already been terminated. ' +
                        '\n\nTime of Attempted Stop:\n'+requestTime
                        );
                } else { // server running, but error
                    console.log('Error during server shutdown: '+jqXHR.responseText);
                    alert('Error during server shutdown: '+jqXHR.responseText);
                }
            },
            success: function(result) {
                alert("Server successfully stopped. You may now close this window.")
            }
        };
        $.ajax(args);
    }

    jade.module_upload = function (j,url) {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        let default_name = j.module['name'].replace(/\//g,'-').substr(1) + '-save.json'
        let module_filename = prompt('Enter the name of the file to save to:', default_name);
        if (module_filename === null) {
            alert('Module extraction cancelled.');
            return;
        }
        if (module_filename.slice(-5) !== '.json') {
            module_filename += '.json';
        }
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, value: JSON.stringify(j.get_state()), module: j.module['name'], module_filename: module_filename},
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'The module has not been downloaded to your device ' +
                        'Please start the python server again and refresh this page ' +
                        'to continue. ' +
                        '\n\nTime of Attempted Module Save:\n'+requestTime
                        );
                } else { // server running, but error
                    console.log('Error during module save: '+jqXHR.responseText);
                    alert('Error during module save: '+jqXHR.responseText);
                }
            },
            success: function(result) {
                alert('Module saved to file '+module_filename);
            }
        };
        $.ajax(args);
    };

    jade.module_combine = function (j,url,new_file_name,files,extra) {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        if (new_file_name === undefined) {
            new_file_name = prompt('Please enter a name for the combined file');
            if (new_file_name === null) {
                alert('Operation cancelled. No changes have been made to your device.');
                return;
            }
        }
        // check if filename ends in .json
        if (new_file_name.slice(-5) !== '.json') {
            new_file_name += '.json';
        }
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, 
                value: JSON.stringify(j.get_state()), 
                combine_name: new_file_name, 
                files: JSON.stringify(files), 
                extra: JSON.stringify(extra)
            },
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'No changes have been made to your device ' +
                        'Please start the python server again and refresh this page ' +
                        'to continue. ' +
                        '\n\nTime of Attempted Module/File Combining:\n'+requestTime
                        );
                } else if (jqXHR.status == 409) {
                    console.log("Conflict detected during module combination");
                    let conflicts = JSON.parse(jqXHR.responseText).conflicts;
                    let resolutions = {};
                    
                    for (let module in conflicts) {
                        let choices = "";
                        for (let i = 0; i < conflicts[module][0].length; i++) {
                            choices += "- " + conflicts[module][0][i] + "\n";
                        }
                        let choice = prompt(
                            'Conflict detected for module \"'+ module +'\". Please confirm ' +
                            'which file should be used by typing in the desired ' +
                            'file\'s name from the conflicting files listed below:\n\n' + choices + '\n'
                            );
                        if (choice === null) {
                            alert('Operation cancelled. No changes have been made to your device.');
                            return;
                        }
                        resolutions[module] = choice;
                    }
                    jade.module_combine(j,url,new_file_name,files,resolutions);
                } else { // server running, but error
                    console.log('Error during combining of modules/files: '+jqXHR.responseText);
                    alert('Error during combining of modules/files: '+jqXHR.responseText);
                }
            },
            success: function(result) {
                alert('Selected contents saved to file '+new_file_name);
            }
        };
        $.ajax(args);
    };

    jade.get_backup_state = function(j,url,callback) {
        return new Promise((resolve, reject) => {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, get_autosave: "GETAUTOSAVE"},
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'Please start the python server again and refresh this page ' +
                        'to continue. ' +
                        '\n\nTime of Attempted Backup:\n'+requestTime
                        );
                } else { // server running, but error
                    console.log('Error during backup: '+jqXHR.responseText);
                    alert('Error during backup: '+jqXHR.responseText);
                    reject(new Error('Error during backup: '+jqXHR.responseText));
                }
            },
            success: function(result) {
                let response = JSON.parse(result);
                let backups_enabled = response["backups_enabled"];
                resolve(backups_enabled);
            }
        };
        $.ajax(args);
        });
    }

    jade.set_backup_state = function(j,url,enabled) {
        if (url === undefined) url = j.configuration.cloud_url;
        const requestTime = Date();
        var args = {
            url: url,
            type: 'POST',
            dataType: 'text',
            data: {key: window.location.pathname, set_autosave: enabled},
            error: function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 0) { // server not running
                    alert(
                        'ERROR: Could not connect to server. ' +
                        'Please start the python server again and refresh this page ' +
                        'to continue. ' +
                        '\n\nTime of Attempted Backup:\n'+requestTime
                        );
                } else { // server running, but error
                    console.log('Error during backup: '+jqXHR.responseText);
                    alert('Error during backup: '+jqXHR.responseText);
                }
            }
        };
        $.ajax(args);
    }

    jade.unsaved_changes = function(which) {
    };

    jade.request_zip_url = undefined;  // not used here...

    var initial_config;

    // set up editor inside of div's with class "jade"
    jade.setup = function (div,setup_channel) {
        // skip if this div has already been configured
        if (div.jade === undefined) {

            // use text from jade.div, if any
            var div_text = $(div).html();
            // strip off <!--[CDATA[ ... ]]--> tag if it's there
            if (div_text.lastIndexOf('<!--[CDATA[',0) === 0) {
                div_text = div_text.substring(11,text.length-5);
            }

            $(div).empty();  // all done with innards
            if (div_text)
                try {
                    initial_config = JSON.parse(div_text);
                } catch(e) {
                    console.log('Error parsing configuration: '+e);
                }
            else initial_config = {};

            /*
            var config = {};
            $.extend(config,initial_config);

            // standalone mode -- module data stored locally
            var saved_state = localStorage.getItem(window.location.pathname);
            if (saved_state) {
                try {
                    saved_state = JSON.parse(saved_state);
                    $.extend(config,saved_state);
                } catch (e) {
                    console.log('Restore of local state failed');
                    console.log(e.stack);
                }
            }
             */

            // now create the editor, pass along initial configuration
            var j = new jade.Jade(div);

            // initialize with state from server
            //j.initialize(config);
            jade.cloud_download(j,window.location.origin);
        }
    };
};

// set up editor inside of the div's with class "jade"
var jade = {};
$(document).ready(function () {
    $('.jade').each(function(index, div) {
        var j = new jade_defs.jade();
        jade_defs.services(j);

        // only the first Jade div can interact with host framework
        j.setup(div,index == 0);
        if (index == 0) {
            jade.initialize = j.initialize;
        }
    });
});
