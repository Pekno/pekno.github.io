const page_nbr = 1;
const item_per_page = 50;
const api_path = "https://pro.rendezvousonline.fr/api-web/";
const session_id = "EhIdBX5SKnJhopq6BWVBFP21XT9y4OewQNgwmhSw";
const today = new Date().toISOString().slice(0, 10);
const audio = new Audio('bell.mp3');

var checks = []
var CNIAndPassportService;
var reasons = [];
var municipalities = [];
var selectedMunicipality;
var maxId = 0;
var beforeDate;
var radius = 75;
var buttonTooltip;

window.onload = function(){

    getPassportAndCNIService().then(services => {
        reasons = services;
        // Only create first card when reasons are loaded
        generateNewGroup();
        lockForm(false);
        document.getElementById('button-start').disabled = true;
    }).catch(error => {
        logErrror(error);
    })

    const municipalityInput = document.getElementById('municipality-input');
    municipalityInput.addEventListener('input', (event) => {
        const buttonStart = document.getElementById('button-start');
        const value = event.target.value;
        const exist = municipalities.filter(x => x.label == value)[0]
        if(!exist){
            selectedMunicipality = null;
            buttonStart.disabled = true;
            if(value && value.length > 3){
                getMunicipality(value).then(res => {
                    municipalities = res;
                    generateOptions("municipality-options", municipalities.map(x => {
                            return {value: x.label, label: x.context}
                        })
                    );
                })
            }
        }else{
            selectedMunicipality = exist;
            municipalityInput.blur();
            buttonStart.disabled = false;
        }
    });

    const createNewGroupButton = document.getElementById('create-new-group-button');
    createNewGroupButton.addEventListener('click', (event) => {
        generateNewGroup();
    })

    const buttonStart = document.getElementById('button-start');
    buttonStart.addEventListener('click', (event) => {
        event.preventDefault();
        init();
        lockForm(true);
    })
    buttonTooltip = new bootstrap.Tooltip(buttonStart.parentElement);

    const buttonStop = document.getElementById('button-stop');
    buttonStop.addEventListener('click', (event) => {
        for(const check of checks){
            clearInterval(check.run);
        }
        lockForm(false);
    })
    
    beforeDateInput = document.getElementById('before-date-input');
    beforeDateInput.addEventListener('change', (event) => {
        beforeDate = event.target.value;
    })
    beforeDateInput.value = today;

    searchRadius = document.getElementById('search-radius');
    searchRadius.addEventListener('input', (event) => {
        radius = event.target.value;
        changeRadiusValue(radius);
    })
    changeRadiusValue(radius);
};

const init = () => {
    if(!selectedMunicipality){return;}
    for(const check of checks){
        getMairieList(check.search_reason_id, check.nbr_people).then( townhalls => {
            check.townhalls = townhalls;
            refresh(check);
            check.run = setInterval(() => {
                refresh(check);
            }, 60 * 1000);
        }).catch(error => {
            logErrror(error);
        })
    }
}

const refresh = async (check) => {
    for (const townhall of check.townhalls) {
        let reason_id = townhall.reasons.find( x => x.search_reason_id == check.search_reason_id);
        if(reason_id){
            getRdvList(townhall.id, reason_id.id, check.nbr_people).then(dates => {
                if(dates.length > 0){
                    for (const date of dates) {
                        for (const hour of date.hours) {
                            const url = buildUrl(townhall.alias, reason_id.id, date.date, hour, check.nbr_people)
                            const asArray = check.appointments[townhall.id];
                            if(!asArray){
                                check.appointments[townhall.id] = [];
                            }
                            const exist = check.appointments[townhall.id].find(x => x.uri === url);
                            const d = Date.parse(date.date + "T" + hour);
                            if(!exist){
                                check.appointments[townhall.id].push({
                                    date : d,
                                    uri : url
                                });
                                audio.play();
                            }
                        }
                    }
                }
            }).catch(error => {
                logErrror(error);
            })
        }
    }
    updateAppointment(check);
    updateAppointmentBadges(check)
    editLastChecked();
}

const generateNewGroup = () => {
    const newId = maxId++;
    checks.push({
        id : newId,
        search_reason_id : 1,
        nbr_people: 1,
        appointments: {},
    },)
    buildNewGroup(newId);
    bindActionToNewGroup(newId);
    generateOptions("reason-select_" + newId, reasons);
}

const getPassportAndCNIService = () => {
    return secureErrorFetch(api_path + "search-services").then(data => {
        let service = data.filter(x => { return x.id === 9})
        if(service.length) {
            CNIAndPassportService = service[0];
            return service[0].search_reasons.map(x => {
                return {label: x.name, value: x.id}
            });
        }else{
            return Promise.reject("No service with this name found");
        }
    })
}

const getMunicipality = (text) => {
    return secureErrorFetch("https://api-adresse.data.gouv.fr/search/?q=" + text + "&type=municipality&autocomplete=1").then(data => {
        if(data){
            return data.features.map(x => {
                const text = x.properties.name + " " + x.properties.postcode;
                const gps = x.geometry.coordinates[1] + "/" + x.geometry.coordinates[0];
                return {id: x.properties.id, label: text, context: x.properties.context, uri: encodeURI(text) + "/" + gps};
            });
        }
        return Promise.reject("No service with this name found");
    })
}

const getMairieList = (search_reason_id, nbr_people) => {
    var reasons_number = createPayload(search_reason_id, nbr_people);
    const encodedService = encodeURI(CNIAndPassportService.name);
    const path = api_path + "search-structures/" + encodedService + "/" + selectedMunicipality.uri + "?reasons_number=" + reasons_number + "&sort=distance&radius=" + radius + "&page=" + page_nbr + "&per_page=" + item_per_page
    return secureErrorFetch(path).then(data => {
        return data.results;
    })
}

const getRdvList = async (townhall_id, reason_id, nbr_people) => {
    const reason_payload = createPayload(reason_id, nbr_people)
    const path = api_path + "structures/" + townhall_id + "/availabilities/week?session_id=" + session_id + "&reasons=" + reason_payload + "&date=" + today + "&direction=1";
    const dates = [];
    return secureErrorFetch(path).then(data => {
        if(!data.message){
            for (const property in data) {
                let d1 = new Date(data[property].date);
                let d2 = new Date(beforeDate);
                if(data[property].availabilities.length > 0 && d1.getTime() < d2.getTime()){
                    let d = {date: data[property].date, hours: []}
                    for (const availability of data[property].availabilities) {
                        d.hours.push(availability.hour)
                    }
                    dates.push(d);
                }
            }
        }
        return dates
    })
}

/* -- INTERFACE -- */

const editLastChecked = () => {
    var lastChecked = document.getElementById("last_checked");
    let now = new Date();
    lastChecked.innerHTML = "Dernières demandes auprès des mairies : " + new Intl.DateTimeFormat('default', {hour: "numeric", minute: "numeric",hour12: false}).format(now);
}

const buildNewGroup = (id) => {
    const groupHolder = document.getElementById('create-new-group-button').parentElement;
    let card = document.getElementById("card_-1")
    let newCard = card.cloneNode(true);
    newCard.id = "card_" + id;
    newCard.style = "";
    newCard.querySelector('h5.card-title').innerHTML = 'Groupe N°' + ( id + 1 );
    newCard.querySelector('#delete-group_-1').id = 'delete-group_' + id;
    newCard.querySelector('#reason-select_-1').id = 'reason-select_' + id;
    newCard.querySelector('#number-people_-1').id = 'number-people_' + id;
    groupHolder.parentElement.insertBefore(newCard, groupHolder);

    const tableHolder = document.getElementById('accordion-parent');
    let accordion = document.getElementById("accordion-item_-1")
    let newAccordion = accordion.cloneNode(true);
    newAccordion.id = "accordion-item_" + id;
    newAccordion.style = "";
    let accordionHeader = newAccordion.querySelector('h2.accordion-header');
    accordionHeader.id = "accordion-heading_" + id
    let accordionHeaderButton = accordionHeader.querySelector('button');
    accordionHeaderButton.dataset.bsTarget = "#accordion-collapse_" + id;
    accordionHeaderButton.setAttribute("aria-controls", "accordion-collapse_" + id);
    accordionHeaderButton.querySelector('#accordion-button-text_-1').textContent = "Rendez-vous du groupe N°" + ( id + 1 );
    let accordionBadge = newAccordion.querySelector('#badge-value_-1');
    accordionBadge.id = "badge-value_" + id;
    accordionBadge.parentElement.hidden = true;
    let accordionCollapse = newAccordion.querySelector('#accordion-collapse_-1');
    accordionCollapse.id = "accordion-collapse_" + id;
    accordionCollapse.setAttribute("aria-labelledby", "accordion-heading_" + id);
    newAccordion.querySelector('#appointments_-1').id = "appointments_" + id;
    tableHolder.appendChild(newAccordion);
}

const bindActionToNewGroup = (id) => {
    // Remove action
    const deleteGroupButton = document.getElementById('delete-group_' + id);
    deleteGroupButton.addEventListener('click', (event) => {
        checks = checks.filter(x => x.id != id);
        document.getElementById('card_' + id).remove();
        document.getElementById('accordion-item_' + id).remove();
    })
    // Group size
    const reasonSelect = document.getElementById('reason-select_' + id);
    reasonSelect.addEventListener('change', (event) => {
        checks[id].search_reason_id = parseInt(event.target.value) ?? 0;
    })
    // Group size
    const numberPeople = document.getElementById('number-people_' + id);
    numberPeople.addEventListener('change', (event) => {
        checks[id].nbr_people = event.target.value ?? 0;
    })
}

const generateOptions = (domId, options) => {
    var datalist = document.getElementById(domId);
    datalist.innerHTML = "";
    for (const option of options) {
        var opt = document.createElement("option");
        opt.value = option.value;
        opt.innerHTML = option.label;
        datalist.appendChild(opt);
    }
}

const logErrror = (error) => {
    var tableRow = document.getElementById("logs");
    var row = document.createElement("tr");
    var cell1 = document.createElement("td");
    var cell2 = document.createElement("td");
    cell1.innerHTML = error;
    let now = new Date();
    cell2.innerHTML = new Intl.DateTimeFormat('default', {hour: "numeric", minute: "numeric",hour12: false}).format(now);
    row.appendChild(cell1);
    row.appendChild(cell2);
    tableRow.appendChild(row);
}

const updateAppointmentBadges = (check) => {
    let nbr = 0;
    for (const key in check.appointments) {
        nbr += check.appointments[key].length;
    }
    const id = check.id;
    const accordionBadge = document.querySelector("#badge-value_"  + id);
    if(nbr > 0){
        accordionBadge.textContent = nbr;
        accordionBadge.parentElement.hidden = false;
    }else{
        accordionBadge.parentElement.hidden = true;
    }
}

const updateAppointment = (check) => {
    var tableRow = document.getElementById("appointments_" + check.id);
    tableRow.innerHTML = '';
    for (const key in check.appointments) {
        let isFirst = true;
        const appointmentsByTownhall = check.appointments[key];
        let townhall = check.townhalls.find(x => x.id == key);
        for (const appointment of appointmentsByTownhall) {
            addAppointment(isFirst, appointmentsByTownhall.length, check.id, townhall.name, appointment.date, appointment.uri);
            isFirst = false;
        }
    }
}

const addAppointment = (isFirst, span, request, name, date, url) => {
    const options = {year: "numeric", month: "numeric", day: "numeric",
           hour: "numeric", minute: "numeric", second: "numeric",
           hour12: false};

    var tableRow = document.getElementById("appointments_" + request);
    var row = document.createElement("tr");

    if(isFirst){
        var cell1 = document.createElement("td");
        cell1.innerHTML = name;
        cell1.rowSpan = span;
        row.appendChild(cell1);
    }

    var cell2 = document.createElement("td");
    cell2.innerHTML = new Intl.DateTimeFormat('default', options).format(date);
    row.appendChild(cell2);
    
    var cell3 = document.createElement("td");
    var a = document.createElement('a'); 
    var link = document.createTextNode("reservation");
    a.appendChild(link); 
    a.title = "reservation";
    a.href = url;
    a.target = "_blank";
    cell3.appendChild(a);
    row.appendChild(cell3);

    tableRow.appendChild(row);
}

const changeRadiusValue = (value) => {
    document.getElementById('search-radius-value').value = value + " Km";
}

const lockForm = (bool) => {
    const formLock = document.getElementById("form-lock");
    const playIcon = document.getElementById("play-icon");
    const spinner = document.getElementById("spinner");
    const buttonStop = document.getElementById('button-stop');
    const buttonStart = document.getElementById('button-start');
    formLock.disabled = bool;
    playIcon.hidden = bool;
    spinner.hidden = !bool;
    buttonStop.disabled = !bool;
    buttonStart.disabled = bool;
    bool ? buttonTooltip.show() : buttonTooltip.hide();
}

/* -- UTILS -- */

const secureErrorFetch = (uri, contentType = 'application/json') => {
    return fetch(uri).then( async response => {
        const isCorrectType = response.headers.get('content-type')?.includes(contentType);
        let data = null;
        if(isCorrectType){
            switch(contentType){
                case 'application/json': data = await response.json(); break;
                default: data = response; break;
            }
        }
        if (!response.ok) {
            const error = (data && data.message) || response.status;
            return Promise.reject(error);
        }
        return data;
    }).catch(error => {
        return Promise.reject(error);
    });
}

const buildUrl = (alias, reason_id, date, hour, nbr_people) => {
    let reasonsPayload = createPayload(reason_id, nbr_people)
    let availability = encodeURI(date + " " + hour)
    return "https://rendezvousonline.fr/alias/" + alias + "/prendre-rendez-vous?service=Carte%20Nationale%20d%27Identit%C3%A9%20%28CNI%29%20et%20Passeport&reasons=" + reasonsPayload + "&availability=" + availability;
}

const createPayload = (a, b) => {
    let temp = {};
    temp[a] = b;
    let stringify = JSON.stringify(temp);
    return encodeURI(stringify);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

// https://pro.rendezvousonline.fr/api-web/search-services

// https://api-adresse.data.gouv.fr/search/?q=860&type=municipality&autocomplete=1

// https://pro.rendezvousonline.fr/api-web/search-reasons

// https://pro.rendezvousonline.fr/api-web/search-structures/Carte%20Nationale%20d'Identit%C3%A9%20(CNI)%20et%20Passeport/Poitiers%2086000/46.586616/0.356849?reasons_number=%7B%222%22:2%7D&sort=distance&radius=50&page=1&per_page=10

// https://pro.rendezvousonline.fr/api-web/structures/2242/availabilities/week?session_id=EhIdBX5SKnJhopq6BWVBFP21XT9y4OewQNgwmhSw&reasons=%7B%221246%22:2%7D&date=2023-01-22&direction=1

// https://rendezvousonline.fr/alias/pleumartin-86450/prendre-rendez-vous?service=Carte%20Nationale%20d%27Identit%C3%A9%20%28CNI%29%20et%20Passeport&reasons=%7B%22266%22%3A2%7D&availability=2023-07-10%2009%3A55